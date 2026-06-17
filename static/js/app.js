// Guarda contra inicialización doble y espera al DOM
if (!window.__ivvisualizer_initialized) {
  window.__ivvisualizer_initialized = true;

  document.addEventListener('DOMContentLoaded', () => {
    // 1. ENLACES AL DOM (HTML)
    const botonConectar = document.getElementById('botonConectar');
    const selectorModo = document.getElementById('selectorModo');
    const barraFijarVal = document.getElementById('barraFijarVal');
    const valorSliderText = document.getElementById('valorSliderText');
    const labelSlider = document.getElementById('labelSlider');
    const canvasEl = document.getElementById('graficoIV');
    
    if (!canvasEl) return; // Nada que hacer si no existe el canvas
    const ctx = canvasEl.getContext('2d');

    // UUIDs fijos del módulo DSD TECH (HM-10)
    const SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
    const CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";

    // Detectar disponibilidad de la API Web Bluetooth
    const hasWebBluetooth = !!(navigator && navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function');
    if (!hasWebBluetooth) {
      console.warn('Web Bluetooth API no disponible en este navegador/contexto');
      if (botonConectar) {
        botonConectar.disabled = true;
        botonConectar.innerText = 'Bluetooth no soportado';
        botonConectar.title = 'Usa Chrome/Edge en localhost o HTTPS';
      }
    }

    // 2. INICIALIZAR GRÁFICA CON DOBLE EJE Y (Chart.js)
    let datosCurva = [];    // Datos para Corriente (Eje izquierdo)
    let datosPotencia = []; // Datos para Potencia (Eje derecho)

    const graficoIV = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'IV-Curve (Current)',
                    data: datosCurva,
                    borderColor: '#ffca28',
                    backgroundColor: 'rgba(255, 202, 40, 0.05)',
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 2,
                    yAxisID: 'y' // Vinculado al eje izquierdo (Corriente)
                },
                {
                    label: 'PV-Curve (Power)',
                    data: datosPotencia,
                    borderColor: '#00e676',
                    backgroundColor: 'rgba(0, 230, 118, 0.05)',
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 2,
                    yAxisID: 'y1' // Vinculado al eje derecho (Potencia)
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            interaction: { mode: 'nearest', intersect: true },
            scales: {
                x: { 
                    type: 'linear', 
                    position: 'bottom', 
                    title: { display: true, text: 'Voltage (V)', color: '#fff' }, 
                    grid: { color: '#444' }, 
                    ticks: { color: '#fff' } 
                },
                y: { 
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Current (A)', color: '#fff' }, 
                    grid: { color: '#444' }, 
                    ticks: { color: '#fff' }, 
                    min: 0, 
                    max: 6 
                },
                y1: { 
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Power (W)', color: '#fff' }, 
                    grid: { drawOnChartArea: false }, // Evita que se crucen las líneas de cuadrícula
                    ticks: { color: '#fff' }, 
                    min: 0, 
                    max: 400 // Escala adaptada a los 400W máximos del sistema
                }
            },
            plugins: {
                legend: { labels: { color: '#fff' } }
            }
        }
    });

    // Buffers para hilos de datos entrantes (se procesarán juntos)
    const puntosBufferIV = [];
    const puntosBufferPV = [];
    const MAX_POINTS = 2000;
    const FLUSH_INTERVAL_MS = 15;

    function flushBufferToChart() {
      if (puntosBufferIV.length === 0 && puntosBufferPV.length === 0) return;
      
      datosCurva.push(...puntosBufferIV.splice(0, puntosBufferIV.length));
      datosPotencia.push(...puntosBufferPV.splice(0, puntosBufferPV.length));
      
      if (datosCurva.length > MAX_POINTS) datosCurva.splice(0, datosCurva.length - MAX_POINTS);
      if (datosPotencia.length > MAX_POINTS) datosPotencia.splice(0, datosPotencia.length - MAX_POINTS);
      
      try { graficoIV.update('none'); } catch (e) { console.warn('Chart update failed', e); }
    }

    const flushTimer = setInterval(flushBufferToChart, FLUSH_INTERVAL_MS);

    // Variables globales de control Bluetooth
    let connectedCharacteristic = null;
    let connectedDevice = null;

    // 3. LÓGICA DE CONEXIÓN BLUETOOTH (DSD TECH / HM-10)
    if (botonConectar && hasWebBluetooth) {
      botonConectar.addEventListener('click', async () => {
        try {
          // Desconexión si ya está conectado
          if (connectedDevice && connectedDevice.gatt && connectedDevice.gatt.connected) {
            try { connectedDevice.gatt.disconnect(); } catch (e) {}
            connectedDevice = null; connectedCharacteristic = null;
            botonConectar.innerText = 'Connect Bluetooth';
            botonConectar.style.background = '';
            return;
          }

          // Filtro específico para encontrar el módulo "DSD TECH"
          const device = await navigator.bluetooth.requestDevice({ 
            filters: [{ namePrefix: 'DSD TECH' }], 
            optionalServices: [SERVICE_UUID] 
          });

          const server = await device.gatt.connect();
          const service = await server.getPrimaryService(SERVICE_UUID);
          const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
          
          connectedCharacteristic = characteristic;
          connectedDevice = device;

          botonConectar.innerText = "⚡ Connected (click to disconnect)";
          botonConectar.style.background = "#2196f3";

          // Activar las notificaciones de la UART
          await characteristic.startNotifications();
          
          characteristic.addEventListener('characteristicvaluechanged', (event) => {
            const value = event.target.value;
            let textoDecodificado = '';
            try { textoDecodificado = new TextDecoder('utf-8').decode(value); } catch (e) { return; }
            textoDecodificado = (textoDecodificado || '').trim();

            // [Aquí configuraremos el procesador de tramas serie del PIC24 en el siguiente paso]
            console.log("Dato recibido de la UART:", textoDecodificado);
          });

        } catch (error) {
          console.error(error);
          botonConectar.innerText = "Error de conexión";
          botonConectar.style.background = "#f44336";
        }
      });
    }

    // 4. LÓGICA DINÁMICA DEL SLIDER (Modos, rangos y unidades)
    // Definimos la configuración para cada tipo de modo
    const configModos = {
        MODO1: { habilitado: true,  min: 0,  max: 100, step: 1,  unidad: "%",  texto: "Setpoint (Duty):" },
        MODO2: { habilitado: true,  min: 10, max: 50,  step: 1,  unidad: "V",  texto: "Setpoint (Input Voltage):" },
        MODO3: { habilitado: true,  min: 0,  max: 400, step: 5,  unidad: "W",  texto: "Setpoint (Input Power):" },
        MODO4: { habilitado: false, min: 0,  max: 100, step: 1,  unidad: "%",  texto: "Setpoint:" } // MPPT Bloqueado
    };

    function actualizarSliderDinámico() {
        const modoActual = selectorModo.value;
        const config = configModos[modoActual];

        if (!config) return;

        // 1. Habilitar o deshabilitar
        barraFijarVal.disabled = !config.habilitado;

        // 2. Aplicar límites físicos y pasos
        barraFijarVal.min = config.min;
        barraFijarVal.max = config.max;
        barraFijarVal.step = config.step;

        // 3. Forzar el valor al mínimo del rango para evitar desbordamientos visuales al cambiar
        barraFijarVal.value = config.min;

        // 4. Actualizar textos en pantalla
        actualizarTextoSlider(config.texto, config.min, config.unidad);
    }

    function actualizarTextoSlider(textoLabel, valor, unidad) {
        labelSlider.innerHTML = `${textoLabel} <span id="valorSliderText">${valor}</span>${unidad}`;
    }

    // Escuchar el cambio en el desplegable de modos
    if (selectorModo && barraFijarVal) {
        selectorModo.addEventListener('change', async () => {
            actualizarSliderDinámico();

            // Opcional: Avisar inmediatamente al PIC24 del cambio de modo
            if (connectedCharacteristic) {
                try {
                    const comandoModo = `SET_MODE:${selectorModo.value}\n`;
                    await connectedCharacteristic.writeValue(new TextEncoder().encode(comandoModo));
                } catch (e) { console.warn("Error enviando modo al PIC24", e); }
            }
        });

        // Escuchar el movimiento en tiempo real del slider (mientras arrastras)
        barraFijarVal.addEventListener('input', () => {
            const modoActual = selectorModo.value;
            const config = configModos[modoActual];
            const spanValor = document.getElementById('valorSliderText');
            if (spanValor) {
                spanValor.innerText = barraFijarVal.value;
            }
        });

        // Escuchar cuando el usuario suelta el slider (envío definitivo del valor por Bluetooth)
        barraFijarVal.addEventListener('change', async () => {
            if (connectedCharacteristic) {
                try {
                    const comandoValor = `SET_VAL:${barraFijarVal.value}\n`;
                    await connectedCharacteristic.writeValue(new TextEncoder().encode(comandoValor));
                    console.log("Enviado consigna:", comandoValor.trim());
                } catch (e) { console.warn("Error enviando consigna al PIC24", e); }
            }
        });

        // Ejecutar una vez al cargar la web para inicializar el estado del slider
        actualizarSliderDinámico();
    }
  });
}

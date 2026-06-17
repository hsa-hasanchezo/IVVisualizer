if (!window.__ivvisualizer_initialized) {
  window.__ivvisualizer_initialized = true;

  // A) VARIABLES GLOBALES DE CALIBRACIÓN (Definidas al inicio para estar disponibles siempre)
  let calibracion = {
      c1: 1.000, c2: 1.000, c3: 1.000, c4: 1.000,
      c5: 1.000, c6: 1.000, c7: 1.000, c8: 1.000
  };

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
                    grid: { drawOnChartArea: false }, 
                    ticks: { color: '#fff' }, 
                    min: 0, 
                    max: 400 
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
          if (connectedDevice && connectedDevice.gatt && connectedDevice.gatt.connected) {
            try { connectedDevice.gatt.disconnect(); } catch (e) {}
            connectedDevice = null; connectedCharacteristic = null;
            botonConectar.innerText = 'Connect Bluetooth';
            botonConectar.style.background = '';
            return;
          }

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

          await characteristic.startNotifications();
          
          characteristic.addEventListener('characteristicvaluechanged', (event) => {
            const value = event.target.value;
            let textoDecodificado = '';
            try { textoDecodificado = new TextDecoder('utf-8').decode(value); } catch (e) { return; }
            textoDecodificado = (textoDecodificado || '').trim();

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
    const configModos = {
        MODO1: { habilitado: true,  min: 0,  max: 100, step: 1,  unidad: "%",  texto: "Setpoint (Duty):" },
        MODO2: { habilitado: true,  min: 10, max: 50,  step: 1,  unidad: "V",  texto: "Setpoint (Input Voltage):" },
        MODO3: { habilitado: true,  min: 0,  max: 400, step: 5,  unidad: "W",  texto: "Setpoint (Input Power):" },
        MODO4: { habilitado: false, min: 0,  max: 100, step: 1,  unidad: "%",  texto: "Setpoint:" }
    };

    function actualizarSliderDinámico() {
        const modoActual = selectorModo.value;
        const config = configModos[modoActual];

        if (!config) return;

        barraFijarVal.disabled = !config.habilitado;
        barraFijarVal.min = config.min;
        barraFijarVal.max = config.max;
        barraFijarVal.step = config.step;
        barraFijarVal.value = config.min;

        actualizarTextoSlider(config.texto, config.min, config.unidad);
    }

    function actualizarTextoSlider(textoLabel, valor, unidad) {
        labelSlider.innerHTML = `${textoLabel} <span id="valorSliderText">${valor}</span>${unidad}`;
    }

    if (selectorModo && barraFijarVal) {
        selectorModo.addEventListener('change', async () => {
            actualizarSliderDinámico();

            if (connectedCharacteristic) {
                try {
                    const comandoModo = `SET_MODE:${selectorModo.value}\n`;
                    await connectedCharacteristic.writeValue(new TextEncoder().encode(comandoModo));
                } catch (e) { console.warn("Error enviando modo al PIC24", e); }
            }
        });

        barraFijarVal.addEventListener('input', () => {
            const modoActual = selectorModo.value;
            const config = configModos[modoActual];
            const spanValor = document.getElementById('valorSliderText');
            if (spanValor) {
                spanValor.innerText = barraFijarVal.value;
            }
        });

        barraFijarVal.addEventListener('change', async () => {
            if (connectedCharacteristic) {
                try {
                    const comandoValor = `SET_VAL:${barraFijarVal.value}\n`;
                    await connectedCharacteristic.writeValue(new TextEncoder().encode(comandoValor));
                    console.log("Enviado consigna:", comandoValor.trim());
                } catch (e) { console.warn("Error enviando consigna al PIC24", e); }
            }
        });

        actualizarSliderDinámico();
    }

    // 5. CONTROL DEL MODAL DE CONFIGURACIÓN (CALIBRACIÓN)
    const botonConfig = document.getElementById('botonConfig');
    const modalConfig = document.getElementById('modalConfig');
    const btnGuardarCal = document.getElementById('btnGuardarCal');
    const btnCancelarCal = document.getElementById('btnCancelarCal');

    if (botonConfig && modalConfig) {
        // Abrir ventana y cargar en los campos numéricos los valores actuales del objeto 'calibracion'
        botonConfig.addEventListener('click', () => {
            document.getElementById('cal_c1').value = calibracion.c1;
            document.getElementById('cal_c2').value = calibracion.c2;
            document.getElementById('cal_c3').value = calibracion.c3;
            document.getElementById('cal_c4').value = calibracion.c4;
            document.getElementById('cal_c5').value = calibracion.c5;
            document.getElementById('cal_c6').value = calibracion.c6;
            document.getElementById('cal_c7').value = calibracion.c7;
            document.getElementById('cal_c8').value = calibracion.c8;
            
            modalConfig.style.display = 'flex'; // Despliega el modal visualmente
        });

        // Botón Cancelar: Cierra la ventana descartando cualquier edición
        btnCancelarCal.addEventListener('click', () => {
            modalConfig.style.display = 'none';
        });

        // Botón Guardar: Salva los nuevos coeficientes en memoria
        btnGuardarCal.addEventListener('click', async () => {
            calibracion.c1 = parseFloat(document.getElementById('cal_c1').value) || 1.0;
            calibracion.c2 = parseFloat(document.getElementById('cal_c2').value) || 1.0;
            calibracion.c3 = parseFloat(document.getElementById('cal_c3').value) || 1.0;
            calibracion.c4 = parseFloat(document.getElementById('cal_c4').value) || 1.0;
            calibracion.c5 = parseFloat(document.getElementById('cal_c5').value) || 1.0;
            calibracion.c6 = parseFloat(document.getElementById('cal_c6').value) || 1.0;
            calibracion.c7 = parseFloat(document.getElementById('cal_c7').value) || 1.0;
            calibracion.c8 = parseFloat(document.getElementById('cal_c8').value) || 1.0;

            console.log("Nuevas constantes guardadas localmente:", calibracion);
            modalConfig.style.display = 'none'; // Esconde el menú

            // Envía la cadena de calibración por BLE si está el hardware activo
            if (connectedCharacteristic) {
                try {
                    const cmdCal = `SET_CAL:${calibracion.c1},${calibracion.c2},${calibracion.c3},${calibracion.c4}\n`;
                    await connectedCharacteristic.writeValue(new TextEncoder().encode(cmdCal));
                } catch(e) { console.warn("No se pudieron enviar las constantes al PIC"); }
            }
        });
    }

  });
}

// Guarda contra inicialización doble y espera al DOM
if (!window.__ivvisualizer_initialized) {
  window.__ivvisualizer_initialized = true;

  // A) VARIABLES GLOBALES DE CALIBRACIÓN (Almacenadas EXCLUSIVAMENTE en la Web)
  let calibracion = {
      V_IN_m: 0.01533,  V_IN_n: 0.038,  
      I_IN_m: 0.00389,  I_IN_n: 0.009,
      V_OUT_m: -0.01650, V_OUT_n: 64.079, 
      I_OUT_m: 0.00386, I_OUT_n: 0.009
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
                    yAxisID: 'y'
                },
                {
                    label: 'PV-Curve (Power)',
                    data: datosPotencia,
                    borderColor: '#00e676',
                    backgroundColor: 'rgba(0, 230, 118, 0.05)',
                    borderWidth: 3,
                    tension: 0.3,
                    pointRadius: 2,
                    yAxisID: 'y1'
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

    // Buffers para hilos de datos entrantes
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

    // 3. LÓGICA DE CONEXIÓN BLUETOOTH
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

    // 4. LÓGICA DINÁMICA DEL SLIDER (Control local y comandos permitidos)
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

    // 5. CONTROL DEL MODAL DE CONFIGURACIÓN (Mantenido 100% aislado del Bluetooth)
    const botonConfig = document.getElementById('botonConfig');
    const modalConfig = document.getElementById('modalConfig');
    const btnGuardarCal = document.getElementById('btnGuardarCal');
    const btnCancelarCal = document.getElementById('btnCancelarCal');

    if (botonConfig && modalConfig) {
        botonConfig.addEventListener('click', () => {
            document.getElementById('cal_c1').value = calibracion.V_IN_m;
            document.getElementById('cal_c2').value = calibracion.V_IN_n;
            document.getElementById('cal_c3').value = calibracion.I_IN_m;
            document.getElementById('cal_c4').value = calibracion.I_IN_n;
            document.getElementById('cal_c5').value = calibracion.V_OUT_m;
            document.getElementById('cal_c6').value = calibracion.V_OUT_n;
            document.getElementById('cal_c7').value = calibracion.I_OUT_m;
            document.getElementById('cal_c8').value = calibracion.I_OUT_n;
            
            modalConfig.style.display = 'flex';
        });

        btnCancelarCal.addEventListener('click', () => {
            modalConfig.style.display = 'none';
        });

        btnGuardarCal.addEventListener('click', () => {
            // Se actualizan las variables locales en la web para cálculos matemáticos posteriores
            calibracion.V_IN_m = parseFloat(document.getElementById('cal_c1').value) || 0.0;
            calibracion.V_IN_n = parseFloat(document.getElementById('cal_c2').value) || 0.0;
            calibracion.I_IN_m = parseFloat(document.getElementById('cal_c3').value) || 0.0;
            calibracion.I_IN_n = parseFloat(document.getElementById('cal_c4').value) || 0.0;
            calibracion.V_OUT_m = parseFloat(document.getElementById('cal_c5').value) || 0.0;
            calibracion.V_OUT_n = parseFloat(document.getElementById('cal_c6').value) || 0.0;
            calibracion.I_OUT_m = parseFloat(document.getElementById('cal_c7').value) || 0.0;
            calibracion.I_OUT_n = parseFloat(document.getElementById('cal_c8').value) || 0.0;

            console.log("Constantes actualizadas con éxito en memoria web:", calibracion);
            modalConfig.style.display = 'none';
            // Aquí NO hay funciones writeValue. El HM-10 no se entera de este cambio.
        });
    }

  });
}

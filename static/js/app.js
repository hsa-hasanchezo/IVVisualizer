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
    
    // Enlaces para los Displays de Telemetría (Asegúrate de que coincidan los IDs en tu HTML)
    const dispVin = document.getElementById('dispVin');
    const dispIin = document.getElementById('dispIin');
    const dispPin = document.getElementById('dispPin');
    const dispVout = document.getElementById('dispVout');
    const dispIout = document.getElementById('dispIout');
    const dispPout = document.getElementById('dispPout');
    const dispDuty = document.getElementById('dispDuty');
    const dispEff = document.getElementById('dispEff');

    if (!canvasEl) return; 
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
      }
    }

    // 2. INICIALIZAR GRÁFICA CON DOBLE EJE Y (Chart.js)
    let datosCurva = [];    
    let datosPotencia = []; 

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

    // Buffers de renderizado de la gráfica
    const puntosBufferIV = [];
    const puntosBufferPV = [];
    const MAX_POINTS = 2000;
    const FLUSH_INTERVAL_MS = 15;

    function flushBufferToChart() {
      
    }

    const flushTimer = setInterval(flushBufferToChart, FLUSH_INTERVAL_MS);

    // Variables de control Bluetooth y Loop de Telemetría
    let connectedCharacteristic = null;
    let connectedDevice = null;
    let loopTelemetria = null; // Guardará el ID del setInterval del polling

    // 3. LÓGICA DE CONEXIÓN BLUETOOTH + PROCESAMIENTO DE DATOS CRÚDOS
    if (botonConectar && hasWebBluetooth) {
      botonConectar.addEventListener('click', async () => {
        try {
          // Desconexión limpia
          if (connectedDevice && connectedDevice.gatt && connectedDevice.gatt.connected) {
            if (loopTelemetria) { clearInterval(loopTelemetria); loopTelemetria = null; }
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
          
          // RECEPTOR Y PROCESADOR MATEMÁTICO DE TELEMETRÍA
          characteristic.addEventListener('characteristicvaluechanged', (event) => {
            const value = event.target.value;
            let textoDecodificado = '';
            try { textoDecodificado = new TextDecoder('utf-8').decode(value); } catch (e) { return; }
            textoDecodificado = (textoDecodificado || '').trim();

            if (!textoDecodificado) return;

            // Esperamos formato: V_IN_raw,I_IN_raw,V_OUT_raw,I_OUT_raw,Duty
            const partes = textoDecodificado.split(',');
            if (partes.length >= 5) {
                // 1. Extraer los datos crudos (raw) enviados por el PIC24
                const vInRaw  = parseFloat(partes[0]) || 0;
                const iInRaw  = parseFloat(partes[1]) || 0;
                const vOutRaw = parseFloat(partes[2]) || 0;
                const iOutRaw = parseFloat(partes[3]) || 0;
                const dutyRaw = parseFloat(partes[4]) || 0;
                const dutyVal = (dutyRaw / 1200) * 100; // Convierte el rango 0-1200 a 0-100%

                // 2. Aplicar fórmulas de calibración local (y = m * x + n)
                const vInReal  = (vInRaw * calibracion.V_IN_m) + calibracion.V_IN_n;
                const iInReal  = (iInRaw * calibracion.I_IN_m) + calibracion.I_IN_n;
                const vOutReal = (vOutRaw * calibracion.V_OUT_m) + calibracion.V_OUT_n;
                const iOutReal = (iOutRaw * calibracion.I_OUT_m) + calibracion.I_OUT_n;

                // 3. Cálculos de Potencia y Eficiencia
                const pInReal  = vInReal * iInReal;
                const pOutReal = vOutReal * iOutReal;
                
                let eficiencia = 0;
                if (pInReal > 0.1) { // Evitamos divisiones por cero o ruido flotante
                    eficiencia = (pOutReal / pInReal) * 100;
                    if (eficiencia > 100) eficiencia = 100; // Capar picos irreales por transitorios
                    if (eficiencia < 0) eficiencia = 0;
                }

                // 4. Actualizar los Displays en el HTML (con toFixed para limitar decimales)
                if (dispVin)  dispVin.innerText  = vInReal.toFixed(1);
                if (dispIin)  dispIin.innerText  = iInReal.toFixed(2);
                if (dispPin)  dispPin.innerText  = pInReal.toFixed(0);
                if (dispVout) dispVout.innerText = vOutReal.toFixed(1);
                if (dispIout) dispIout.innerText = iOutReal.toFixed(2);
                if (dispPout) dispPout.innerText = pOutReal.toFixed(0);
                if (dispDuty) dispDuty.innerText = dutyVal.toFixed(1);
                if (dispEff)  dispEff.innerText  = eficiencia.toFixed(1);
            }
          });

          // DISPARADOR PERIÓDICO (Ejecución cada 250ms para un refresco fluido de 4Hz)
          // Envía de forma exacta los bytes binarios solicitados: [0xAA, 0xA6, 0x00, 0x00]
          loopTelemetria = setInterval(async () => {
              if (connectedCharacteristic) {
                  try {
                      const comandoBytes = new Uint8Array([0xAA, 0xA6, 0x00, 0x00]);
                      await connectedCharacteristic.writeValue(comandoBytes);
                  } catch (e) {
                      console.warn("Fallo en el sub-loop de polling de telemetría", e);
                  }
              }
          }, 250);

        } catch (error) {
          console.error(error);
          botonConectar.innerText = "Error de conexión";
          botonConectar.style.background = "#f44336";
          if (loopTelemetria) { clearInterval(loopTelemetria); loopTelemetria = null; }
        }
      });
    }

    // 4. LÓGICA DINÁMICA DEL SLIDER
    const configModos = {
        MODO1: { habilitado: false, min: 0,  max: 100, step: 1,  unidad: "%",  texto: "MPPT Automático",             byteModo: 0xB1 },
        MODO2: { habilitado: true,  min: 10, max: 50,  step: 1,  unidad: "V",  texto: "Setpoint (Input Voltage):",   byteModo: 0xB2 },
        MODO3: { habilitado: true,  min: 0,  max: 100, step: 1,  unidad: "%",  texto: "Setpoint (Duty Cycle):",      byteModo: 0xB3 },
        MODO4: { habilitado: true,  min: 0,  max: 400, step: 5,  unidad: "W",  texto: "Setpoint (Input Power):",     byteModo: 0xB4 }
    };

    // Calcula el valor RAW de 16 bits según tu mapa de firmware y envía la trama [0xAA, Modo, MSB, LSB]
    async function enviarComandoBinario() {
        if (!connectedCharacteristic) return;

        const modoActual = selectorModo.value;
        const config = configModos[modoActual];
        if (!config) return;

        const valorSlider = parseFloat(barraFijarVal.value) || 0;
        let valorRaw16 = 0;

        // Procesamiento matemático basado en tu mapa de control real
        if (modoActual === 'MODO1') {
            // MODO MPPT: Control automático, la consigna es irrelevante (enviamos 0)
            valorRaw16 = 0;
        } 
        else if (modoActual === 'MODO2') {
            // VOLTAGE MODE: Despejamos el valor RAW usando la calibración -> raw = (V - n) / m
            valorRaw16 = Math.round((valorSlider - calibracion.V_IN_n) / calibracion.V_IN_m);
        } 
        else if (modoActual === 'MODO3') {
            // DUTY CYCLE MODE: Convertimos el % del slider al rango de trabajo del PIC24 (0 - 1200)
            valorRaw16 = Math.round(valorSlider * 12);
        }
        else if (modoActual === 'MODO4') {
            // POWER MODE: Enviamos el valor entero de vatios directo (0 - 400)
            valorRaw16 = Math.round(valorSlider);
        }

        // Protección contra desbordamientos (Entero de 16 bits sin signo: 0 a 65535)
        if (valorRaw16 < 0) valorRaw16 = 0;
        if (valorRaw16 > 65535) valorRaw16 = 65535;

        // Descomponer en MSB (Byte alto) y LSB (Byte bajo)
        const msb = (valorRaw16 >> 8) & 0xFF;
        const lsb = valorRaw16 & 0xFF;

        // Construcción de la trama binaria de 4 bytes
        const tramaComando = new Uint8Array([0xAA, config.byteModo, msb, lsb]);

        try {
            await connectedCharacteristic.writeValue(tramaComando);
            console.log(`Enviado -> Modo: 0x${config.byteModo.toString(16).toUpperCase()}, Valor Raw: ${valorRaw16} (MSB: 0x${msb.toString(16).toUpperCase()}, LSB: 0x${lsb.toString(16).toUpperCase()})`);
        } catch (e) {
            console.warn("Error enviando comando binario al PIC24", e);
        }
    }

    function actualizarSliderDinámico() {
        const modoActual = selectorModo.value;
        const config = configModos[modoActual];
        if (!config) return;

        barraFijarVal.disabled = !config.habilitado;
        barraFijarVal.min = config.min;
        barraFijarVal.max = config.max;
        barraFijarVal.step = config.step;
        barraFijarVal.value = config.min;

        if (config.habilitado) {
            actualizarTextoSlider(config.texto, config.min, config.unidad);
        } else {
            // Si es MPPT, ocultamos el valor numérico del slider ya que no aplica
            labelSlider.innerHTML = `<strong>${config.texto}</strong>`;
        }
    }

    function actualizarTextoSlider(textoLabel, valor, unidad) {
        labelSlider.innerHTML = `${textoLabel} <span id="valorSliderText">${valor}</span>${unidad}`;
    }

    if (selectorModo && barraFijarVal) {
        // Evento al cambiar el selector de modo
        selectorModo.addEventListener('change', async () => {
            actualizarSliderDinámico();
            await enviarComandoBinario();
        });

        // Evento dinámico mientras arrastras el slider
        barraFijarVal.addEventListener('input', () => {
            const spanValor = document.getElementById('valorSliderText');
            if (spanValor) {
                spanValor.innerText = barraFijarVal.value;
            }
        });

        // Evento definitivo al soltar el slider
        barraFijarVal.addEventListener('change', async () => {
            await enviarComandoBinario();
        });

        actualizarSliderDinámico();
    }


    // 5. CONTROL DEL MODAL DE CONFIGURACIÓN (CALIBRACIÓN)
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
        });
    }

  });
}     

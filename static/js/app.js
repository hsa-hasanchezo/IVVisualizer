// Guarda contra inicialización doble y espera al DOM
if (!window.__ivvisualizer_initialized) {
  window.__ivvisualizer_initialized = true;

  // A) VARIABLES GLOBALES DE CALIBRACIÓN (Almacenadas EXCLUSIVAMENTE en la Web)
  let calibracion = {
      V_IN_m: 0.01533,  V_IN_n: 0.038,  
      I_IN_m: 0.00389,  I_IN_n: 0.009,
      V_OUT_m: -0.01640, V_OUT_n: 63.812, 
      I_OUT_m: 0.00386, I_OUT_n: 0.009
  };

  // Parámetro de configuración para el barrido de curva
  let puntosBarridoConfig = 100; 

  document.addEventListener('DOMContentLoaded', () => {
    // 1. ENLACES AL DOM (HTML)
    const botonConectar = document.getElementById('botonConectar');
    const botonBarrido = document.getElementById('botonBarrido'); // Asegúrate de añadir este ID en tu botón del HTML
    const selectorModo = document.getElementById('selectorModo');
    const barraFijarVal = document.getElementById('barraFijarVal');
    const labelSlider = document.getElementById('labelSlider');
    
    // Enlaces para los Canvas independientes
    const canvasIV = document.getElementById('graficoIV');
    const canvasPV = document.getElementById('graficoPV'); // Asegúrate de tener este nuevo canvas en el HTML
    
    // Enlaces para los Displays de Telemetría
    const dispVin = document.getElementById('dispVin');
    const dispIin = document.getElementById('dispIin');
    const dispPin = document.getElementById('dispPin');
    const dispVout = document.getElementById('dispVout');
    const dispIout = document.getElementById('dispIout');
    const dispPout = document.getElementById('dispPout');
    const dispDuty = document.getElementById('dispDuty');
    const dispEff = document.getElementById('dispEff');

    if (!canvasIV || !canvasPV) return; 
    const ctxIV = canvasIV.getContext('2d');
    const ctxPV = canvasPV.getContext('2d');

    // UUIDs fijos del módulo DSD TECH (HM-10)
    const SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";
    const CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";

    const hasWebBluetooth = !!(navigator && navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function');
    if (!hasWebBluetooth && botonConectar) {
        botonConectar.disabled = true;
        botonConectar.innerText = 'Bluetooth no soportado';
    }

    // 2. INICIALIZAR GRÁFICAS SEPARADAS (Chart.js)
    let datosCurvaIV = [];    
    let datosCurvaPV = []; 

    const graficoIV = new Chart(ctxIV, {
        type: 'line',
        data: {
            datasets: [{
                label: 'I-V Curve',
                data: datosCurvaIV,
                borderColor: '#ffca28',
                backgroundColor: 'rgba(255, 202, 40, 0.05)',
                borderWidth: 3,
                tension: 0.2,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Voltage (V)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: 55 },
                y: { type: 'linear', position: 'left', title: { display: true, text: 'Current (A)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: 15 }
            },
            plugins: { legend: { labels: { color: '#fff' } } }
        }
    });

    const graficoPV = new Chart(ctxPV, {
        type: 'line',
        data: {
            datasets: [{
                label: 'P-V Curve',
                data: datosCurvaPV,
                borderColor: '#00e676',
                backgroundColor: 'rgba(0, 230, 118, 0.05)',
                borderWidth: 3,
                tension: 0.2,
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Voltage (V)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: 55 },
                y: { type: 'linear', position: 'left', title: { display: true, text: 'Power (W)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: 500 }
            },
            plugins: { legend: { labels: { color: '#fff' } } }
        }
    });

    // Variables de control Bluetooth, Flujo y Máquina de Estados
    let connectedCharacteristic = null;
    let connectedDevice = null;
    let loopTelemetria = null; 
    let bluetoothBufferTexto = ""; 
    
    let modoBarridoActivo = false;
    let lineasBarridoAcumuladas = [];

    // Funciones de control de Polling de Telemetría
    function iniciarPollingTelemetria() {
        if (loopTelemetria) clearInterval(loopTelemetria);
        loopTelemetria = setInterval(async () => {
            if (connectedCharacteristic && !modoBarridoActivo) {
                try {
                    const comandoBytes = new Uint8Array([0xAA, 0xA6, 0x00, 0x00]);
                    await connectedCharacteristic.writeValue(comandoBytes);
                } catch (e) {
                    console.warn("Fallo en polling de telemetría", e);
                }
            }
        }, 250);
    }

    function detenerPollingTelemetria() {
        if (loopTelemetria) {
            clearInterval(loopTelemetria);
            loopTelemetria = null;
        }
    }

    // 3. LÓGICA DE CONEXIÓN BLUETOOTH + PROCESAMIENTO MULTI-MODO
    if (botonConectar && hasWebBluetooth) {
      botonConectar.addEventListener('click', async () => {
        try {
          if (connectedDevice && connectedDevice.gatt && connectedDevice.gatt.connected) {
            detenerPollingTelemetria();
            if (connectedCharacteristic) {
                try {
                    const comandoApagar = new Uint8Array([0xAA, 0xB3, 0x00, 0x00]);
                    await connectedCharacteristic.writeValue(comandoApagar);
                } catch (e) {}
            }
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
          
          // RECEPTOR CON BUFFER INTELIGENTE (TELEMETRÍA + BARRIDO IV/PV)
          characteristic.addEventListener('characteristicvaluechanged', (event) => {
            const value = event.target.value;
            let fragmentoDecodificado = '';
            try { 
                fragmentoDecodificado = new TextDecoder('utf-8').decode(value); 
            } catch (e) { return; }
            
            bluetoothBufferTexto += fragmentoDecodificado;

            if (bluetoothBufferTexto.includes('\n')) {
                const lineas = bluetoothBufferTexto.split('\n');
                bluetoothBufferTexto = lineas.pop(); 

                for (let i = 0; i < lineas.length; i++) {
                    const lineaLimpia = lineas[i].trim();
                    if (!lineaLimpia) continue;

                    // CASO A: MODO BARRIDO DE CURVA ACTIVO
                    if (modoBarridoActivo) {
                        if (lineaLimpia === "END") {
                            console.log(`Barrido completo. Procesando ${lineasBarridoAcumuladas.length} puntos.`);
                            procesarYGraficarCurvas(lineasBarridoAcumuladas);
                            
                            // Restaurar estados normales
                            lineasBarridoAcumuladas = [];
                            modoBarridoActivo = false;
                            if (botonBarrido) {
                                botonBarrido.innerText = "Obtener IV";
                                botonBarrido.disabled = false;
                            }
                            iniciarPollingTelemetria(); // Volvemos a pedir telemetría automáticamente
                        } else {
                            lineasBarridoAcumuladas.push(lineaLimpia);
                        }
                    } 
                    // CASO B: MODO TELEMETRÍA NORMAL
                    else {
                        const partes = lineaLimpia.split(',');
                        if (partes.length >= 5) {
                            const vInRaw  = parseFloat(partes[0]) || 0;
                            const iInRaw  = parseFloat(partes[1]) || 0;
                            const vOutRaw = parseFloat(partes[2]) || 0;
                            const iOutRaw = parseFloat(partes[3]) || 0;
                            const dutyRaw = parseFloat(partes[4]) || 0;
                            
                            const dutyVal = (dutyRaw / 1200) * 100; 

                            const vInReal  = (vInRaw * calibracion.V_IN_m) + calibracion.V_IN_n;
                            const iInReal  = (iInRaw * calibracion.I_IN_m) + calibracion.I_IN_n;
                            const vOutReal = (vOutRaw * calibracion.V_OUT_m) + calibracion.V_OUT_n;
                            const iOutReal = (iOutRaw * calibracion.I_OUT_m) + calibracion.I_OUT_n;

                            const pInReal  = vInReal * iInReal;
                            const pOutReal = vOutReal * iOutReal;
                            
                            let eficiencia = 0;
                            if (pInReal > 0.1) {
                                eficiencia = (pOutReal / pInReal) * 100;
                                if (eficiencia > 100) eficiencia = 100; 
                                if (eficiencia < 0) eficiencia = 0;
                            }

                            if (dispVin)  dispVin.innerText  = vInReal.toFixed(2);
                            if (dispIin)  dispIin.innerText  = iInReal.toFixed(2);
                            if (dispPin)  dispPin.innerText  = pInReal.toFixed(1);
                            if (dispVout) dispVout.innerText = vOutReal.toFixed(2);
                            if (dispIout) dispIout.innerText = iOutReal.toFixed(2);
                            if (dispPout) dispPout.innerText = pOutReal.toFixed(1);
                            if (dispDuty) dispDuty.innerText = dutyVal.toFixed(0);
                            if (dispEff)  dispEff.innerText  = eficiencia.toFixed(1);
                        }
                    }
                }
            }
          });

          // Iniciar el bucle periódico de lecturas
          iniciarPollingTelemetria();

        } catch (error) {
          console.error(error);
          botonConectar.innerText = "Error de conexión";
          botonConectar.style.background = "#f44336";
          detenerPollingTelemetria();
        }
      });
    }

    // INTERRUPTOR DE ACCIÓN: DISPARAR BARRIDO DE CURVA DESDE LA WEB
    if (botonBarrido) {
        botonBarrido.addEventListener('click', async () => {
            if (!connectedCharacteristic) {
                alert("Primero debes conectar el dispositivo Bluetooth.");
                return;
            }

            try {
                botonBarrido.disabled = true;
                botonBarrido.innerText = "⏳ Midiendo...";
                
                // 1. Congelar telemetría normal y purgar buffers viejos
                detenerPollingTelemetria();
                modoBarridoActivo = true;
                lineasBarridoAcumuladas = [];
                bluetoothBufferTexto = "";

                // 2. Extraer MSB y LSB de la variable global de puntos (ej: 255 -> 0x00, 0xFF)
                const msb = (puntosBarridoConfig >> 8) & 0xFF;
                const lsb = puntosBarridoConfig & 0xFF;

                // Trama binaria solicitada: [0xAA, 0xC1, MSB, LSB]
                const comandoBarrido = new Uint8Array([0xAA, 0xC1, msb, lsb]);
                
                // 3. Enviar comando al PIC24
                await connectedCharacteristic.writeValue(comandoBarrido);
                console.log(`Solicitado Barrido IV de ${puntosBarridoConfig} puntos.`);

            } catch (e) {
                console.error("Error al iniciar el barrido", e);
                botonBarrido.disabled = false;
                botonBarrido.innerText = "Obtener IV";
                modoBarridoActivo = false;
                iniciarPollingTelemetria();
            }
        });
    }

    // PROCESADOR Y FORMATEADOR DE CURVAS DESACOPLADAS
    function procesarYGraficarCurvas(lineas) {
        let nuevosPuntosIV = [];
        let nuevosPuntosPV = [];

        for (let i = 0; i < lineas.length; i++) {
            const tokens = lineas[i].split(',');
            if (tokens.length === 2) {
                const vRaw = parseFloat(tokens[0]);
                const iRaw = parseFloat(tokens[1]);

                if (!isNaN(vRaw) && !isNaN(iRaw)) {
                    // Aplicamos calibración local estricta de entrada
                    const vCalibrado = (vRaw * calibracion.V_IN_m) + calibracion.V_IN_n;
                    const iCalibrado = (iRaw * calibracion.I_IN_m) + calibracion.I_IN_n;
                    const pCalculada = vCalibrado * iCalibrado;

                    // Guardamos estructurado para Chart.js {x: Voltaje, y: Variable}
                    nuevosPuntosIV.push({ x: vCalibrado, y: iCalibrado });
                    nuevosPuntosPV.push({ x: vCalibrado, y: pCalculada });
                }
            }
        }

        // Ordenamos los arrays por el eje X (Voltaje) de menor a mayor
        // Esto evita líneas cruzadas raras si el PIC envía datos en desorden
        nuevosPuntosIV.sort((a, b) => a.x - b.x);
        nuevosPuntosPV.sort((a, b) => a.x - b.x);

        // Volcar datos procesados en las gráficas independientes
        graficoIV.data.datasets[0].data = nuevosPuntosIV;
        graficoPV.data.datasets[0].data = nuevosPuntosPV;

        // Forzar repintado inmediato de las interfaces gráficas
        graficoIV.update();
        graficoPV.update();
    }

    // 4. LÓGICA DINÁMICA DEL SLIDER Y COMANDOS BINARIOS EN ESPAÑOL RECONFIGURADOS
    const configModos = {
        // MODO MPPT: Ahora habilitado de 0 a 400W para limitar la potencia máxima de entrada
        MODO1: { habilitado: true,  min: 0,  max: 400, step: 5,  unidad: "W",  texto: "MPPT (Max Power Limit):",     byteModo: 0xB1 },
        MODO2: { habilitado: true,  min: 10, max: 50,  step: 1,  unidad: "V",  texto: "Setpoint (Input Voltage):",   byteModo: 0xB2 },
        MODO3: { habilitado: true,  min: 0,  max: 100, step: 1,  unidad: "%",  texto: "Setpoint (Duty Cycle):",      byteModo: 0xB3 },
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
            // MODO MPPT: Multiplica la potencia límite seleccionada (0-400W) por 40 para el PIC24
            valorRaw16 = Math.round(valorSlider * 84);
        } 
        else if (modoActual === 'MODO2') {
            // VOLTAGE MODE: Despejamos el valor RAW usando la calibración -> raw = (V - n) / m
            valorRaw16 = Math.round((valorSlider - calibracion.V_IN_n) / calibracion.V_IN_m);
        } 
        else if (modoActual === 'MODO3') {
            // DUTY CYCLE MODE: Convertimos el % del slider al rango de trabajo del PIC24 (0 - 1200)
            valorRaw16 = Math.round(valorSlider * 12);
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
        
        // Forzamos que se mantenga el valor mínimo inicial del modo seleccionado (0W para MPPT, 0% para Duty, etc.)
        barraFijarVal.value = config.min;

        // Como ahora todos los modos están habilitados, siempre actualizamos el texto de forma dinámica
        actualizarTextoSlider(config.texto, config.min, config.unidad);
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

        // Llama a la inicialización dinámica basada en el "selected" asignado por defecto en el HTML
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

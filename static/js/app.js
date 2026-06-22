// Guarda contra inicialización doble y espera al DOM
if (!window.__ivvisualizer_initialized) {
  window.__ivvisualizer_initialized = true;

  // A) VARIABLES GLOBALES DE CALIBRACIÓN Y GRÁFICAS (Persistencia con localStorage)
  let calibracion = {
      V_IN_m: 0.01533,  V_IN_n: 0.038,  
      I_IN_m: 0.00389,  I_IN_n: 0.009,
      V_OUT_m: -0.01640, V_OUT_n: 63.812, 
      I_OUT_m: 0.00386, I_OUT_n: 0.009
  };

  // Nuevas variables globales para límites de ejes y resolución de barrido
  let limitesGraficas = {
      maxVoltaje: 60,
      maxCorriente: 14,
      maxPotencia: 500
  };

  // Parámetro de configuración para el barrido de curva
  let puntosBarridoConfig = 100; 

  // FUNCIÓN PARA CARGAR LA CONFIGURACIÓN DE LOCALSTORAGE
  function cargarConfiguracionLocal() {
      const calGuardada = localStorage.getItem('pv_calibracion');
      if (calGuardada) {
          calibracion = JSON.parse(calGuardada);
      }
      const limGuardados = localStorage.getItem('pv_limites_graficas');
      if (limGuardados) {
          limitesGraficas = JSON.parse(limGuardados);
      }
      const ptsGuardados = localStorage.getItem('pv_puntos_barrido');
      if (ptsGuardados) {
          puntosBarridoConfig = parseInt(ptsGuardados, 10);
      }
  }

  // Cargar configuraciones antes de inicializar la interfaz
  cargarConfiguracionLocal();

  document.addEventListener('DOMContentLoaded', () => {
    // 1. ENLACES AL DOM (HTML)
    const botonConectar = document.getElementById('botonConectar');
    const botonBarrido = document.getElementById('botonBarrido'); 
    const botonFreeze = document.getElementById('botonFreeze'); // <- NUEVO
    const botonClear = document.getElementById('botonClear');   // <- NUEVO
    const botonDownloadCSV = document.getElementById('botonDownloadCSV'); // <- ENLACE CSV
    const selectorModo = document.getElementById('selectorModo');
    const barraFijarVal = document.getElementById('barraFijarVal');
    const labelSlider = document.getElementById('labelSlider');
    
    // Enlaces para los Canvas independientes
    const canvasIV = document.getElementById('graficoIV');
    const canvasPV = document.getElementById('graficoPV'); 
    
    // Enlaces para los Displays de Telemetría
    const dispVin = document.getElementById('dispVin');
    const dispIin = document.getElementById('dispIin');
    const dispPin = document.getElementById('dispPin');
    const dispVout = document.getElementById('dispVout');
    const dispIout = document.getElementById('dispIout');
    const dispPout = document.getElementById('dispPout');
    const dispDuty = document.getElementById('dispDuty');
    const dispEff = document.getElementById('dispEff');

    // Enlaces a los nuevos controles del modal
    const cfgMaxVoltaje = document.getElementById('cfgMaxVoltaje');
    const cfgMaxCorriente = document.getElementById('cfgMaxCorriente');
    const cfgMaxPotencia = document.getElementById('cfgMaxPotencia');
    const cfgPuntosBarrido = document.getElementById('cfgPuntosBarrido');
    const cfgPuntosBarridoText = document.getElementById('cfgPuntosBarridoText');

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

    // 2. INICIALIZAR GRÁFICAS SEPARADAS CON LÍMITES DINÁMICOS
    let datosCurvaIV = [];    
    let datosCurvaPV = []; 
    let datosCurvaIV_Frozen = []; // Conservar copia de datos congelados para recalculado de tabla

    const graficoIV = new Chart(ctxIV, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'I-V Curve',
                    data: datosCurvaIV,
                    borderColor: '#ffca28',
                    backgroundColor: 'rgba(255, 202, 40, 0.05)',
                    borderWidth: 3,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 0
                },
                {
                    label: 'Operating Point',
                    data: [], 
                    borderColor: '#ffca28',      
                    backgroundColor: '#ffca28',  
                    pointRadius: 8,              
                    pointHoverRadius: 10,
                    showLine: false              
                },
                {
                    label: 'Frozen I-V Curve', // <- NUEVO DATASET CONGELADO (Índice 2)
                    data: [],
                    borderColor: 'rgba(144, 164, 174, 0.6)', // Gris azulado tenue
                    backgroundColor: 'rgba(144, 164, 174, 0.05)',
                    borderWidth: 2,
                    borderDash: [6, 4], // Línea discontinua para mejor visualización
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Voltage (V)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: limitesGraficas.maxVoltaje },
                y: { type: 'linear', position: 'left', title: { display: true, text: 'Current (A)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: limitesGraficas.maxCorriente }
            },
            plugins: { 
                legend: { labels: { color: '#fff' } },
                tooltip: {
                    mode: 'nearest',
                    intersect: true,
                    callbacks: {
                        title: function() { return ''; }, 
                        label: function(context) {
                            const xVal = context.parsed.x.toFixed(2);
                            const yVal = context.parsed.y.toFixed(2);
                            let prefix = '';
                            if (context.datasetIndex === 1) prefix = ' LIVE:';
                            if (context.datasetIndex === 2) prefix = ' FROZEN:';
                            return `${prefix} Voltage: ${xVal} V | Current: ${yVal} A`;
                        }
                    }
                }
            }
        }
    });

    const graficoPV = new Chart(ctxPV, {
        type: 'line',
        data: {
            datasets: [
                {
                    label: 'P-V Curve',
                    data: datosCurvaPV,
                    borderColor: '#00e676',
                    backgroundColor: 'rgba(0, 230, 118, 0.05)',
                    borderWidth: 3,
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 0
                },
                {
                    label: 'Operating Point',
                    data: [], 
                    borderColor: '#00e676',      
                    backgroundColor: '#00e676',  
                    pointRadius: 8,              
                    pointHoverRadius: 10,
                    showLine: false              
                },
                {
                    label: 'Frozen P-V Curve', // <- NUEVO DATASET CONGELADO (Índice 2)
                    data: [],
                    borderColor: 'rgba(144, 164, 174, 0.6)', 
                    backgroundColor: 'rgba(144, 164, 174, 0.05)',
                    borderWidth: 2,
                    borderDash: [6, 4],
                    tension: 0.2,
                    pointRadius: 0,
                    pointHoverRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Voltage (V)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: limitesGraficas.maxVoltaje },
                y: { type: 'linear', position: 'left', title: { display: true, text: 'Power (W)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: limitesGraficas.maxPotencia }
            },
            plugins: { 
                legend: { labels: { color: '#fff' } },
                tooltip: {
                    mode: 'nearest',
                    intersect: true,
                    callbacks: {
                        title: function() { return ''; },
                        label: function(context) {
                            const xVal = context.parsed.x.toFixed(2);
                            const yVal = context.parsed.y.toFixed(1);
                            let prefix = '';
                            if (context.datasetIndex === 1) prefix = 'LIVE:';
                            if (context.datasetIndex === 2) prefix = 'FROZEN:';
                            return `${prefix} Voltage: ${xVal} V | Power: ${yVal} W`;
                        }
                    }
                }
            }
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


    // FUNCIÓN AUXILIAR PARA CALCULAR Y MOSTRAR LOS PARÁMETROS EN LA TABLA
    function calcularYMostrarParametros(puntosIV, tipo) {
        // 'tipo' puede ser 'viva' o 'frozen'
        // Mapeamos al prefijo exacto del HTML: 'tblCur' para la actual, 'tblFrz' para la congelada
        const prefix = tipo === 'viva' ? 'tblCur' : 'tblFrz';
    
        const elVoc = document.getElementById(`${prefix}Voc`);
        const elIsc = document.getElementById(`${prefix}Isc`);
        const elVmpp = document.getElementById(`${prefix}Vmpp`);
        const elImpp = document.getElementById(`${prefix}Impp`);
        const elPmpp = document.getElementById(`${prefix}Pmpp`);
        const elFf = document.getElementById(`${prefix}Ff`); // <- Añadido Fill Factor
    
        if (!puntosIV || puntosIV.length === 0) {
            if (elVoc) elVoc.innerText = "-";
            if (elIsc) elIsc.innerText = "-";
            if (elVmpp) elVmpp.innerText = "-";
            if (elImpp) elImpp.innerText = "-";
            if (elPmpp) elPmpp.innerText = "-";
            if (elFf) elFf.innerText = "-";
            return;
        }
    
        // 1. ISC: Corriente a V mas cercana a 0 (primer punto ordenado por X)
        let isc = puntosIV[0].y;
    
        // 2. VOC: Voltaje a I mas cercana a 0 (último punto del barrido)
        let voc = puntosIV[puntosIV.length - 1].x;
    
        // 3. MPP (Maximum Power Point)
        let pMax = 0;
        let vMpp = 0;
        let iMpp = 0;
    
        puntosIV.forEach(punto => {
            let potencia = punto.x * punto.y;
            if (potencia > pMax) {
                pMax = potencia;
                vMpp = punto.x;
                iMpp = punto.y;
            }
        });
    
        // 4. Calcular Fill Factor (FF)
        let ff = 0;
        if (voc > 0 && isc > 0) {
            ff = (pMax / (voc * isc)) * 100;
        }

    // Escribir datos formateados en la tabla coincidiendo con el HTML
    if (elVoc) elVoc.innerText = voc.toFixed(2);
    if (elIsc) elIsc.innerText = isc.toFixed(2);
    if (elVmpp) elVmpp.innerText = vMpp.toFixed(2);
    if (elImpp) elImpp.innerText = iMpp.toFixed(2);
    if (elPmpp) elPmpp.innerText = pMax.toFixed(1);
    if (elFf) elFf.innerText = ff.toFixed(1);
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
                                botonBarrido.innerText = "Get I-V Curve";
                                botonBarrido.disabled = false;
                            }
                            iniciarPollingTelemetria(); 
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

                            if (dispVin)  dispVin.innerText  = vInReal.toFixed(1);
                            if (dispIin)  dispIin.innerText  = iInReal.toFixed(1);
                            if (dispPin)  dispPin.innerText  = pInReal.toFixed(0);
                            if (dispVout) dispVout.innerText = vOutReal.toFixed(1);
                            if (dispIout) dispIout.innerText = iOutReal.toFixed(1);
                            if (dispPout) dispPout.innerText = pOutReal.toFixed(0);
                            if (dispDuty) dispDuty.innerText = dutyVal.toFixed(0);
                            if (dispEff)  dispEff.innerText  = eficiencia.toFixed(0);

                            // ACTUALIZAR PUNTO GORDO EN TIEMPO REAL
                            graficoIV.data.datasets[1].data = [{ x: vInReal, y: iInReal }];
                            graficoPV.data.datasets[1].data = [{ x: vInReal, y: pInReal }];
                            
                            graficoIV.update();
                            graficoPV.update();
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

    // INTERRUPTOR DE ACCIÓN: DISPARAR BARRIDO DE CURVA CON PUNTOS CONFIGURADOS
    if (botonBarrido) {
        botonBarrido.addEventListener('click', async () => {
            if (!connectedCharacteristic) {
                alert("Primero debes conectar el dispositivo Bluetooth.");
                return;
            }

            try {
                botonBarrido.disabled = true;
                botonBarrido.innerText = "⏳ Measuring...";
                
                detenerPollingTelemetria();
                modoBarridoActivo = true;
                lineasBarridoAcumuladas = [];
                bluetoothBufferTexto = "";

                // Extraer MSB y LSB de la variable global dinámica
                const msb = (puntosBarridoConfig >> 8) & 0xFF;
                const lsb = puntosBarridoConfig & 0xFF;

                const comandoBarrido = new Uint8Array([0xAA, 0xC1, msb, lsb]);
                
                await connectedCharacteristic.writeValue(comandoBarrido);
                console.log(`Solicitado Barrido IV dinámico de ${puntosBarridoConfig} puntos.`);

            } catch (e) {
                console.error("Error al iniciar el barrido", e);
                botonBarrido.disabled = false;
                botonBarrido.innerText = "Get I-V Curve";
                modoBarridoActivo = false;
                iniciarPollingTelemetria();
            }
        });
    }

    // Escuchador de Acción: FREEZE CURVE (MODIFICADO)
    if (botonFreeze) {
        botonFreeze.addEventListener('click', () => {
            // Copiar los datos actuales medidos (Dataset 0) al dataset congelado (Dataset 2)
            graficoIV.data.datasets[2].data = [...graficoIV.data.datasets[0].data];
            graficoPV.data.datasets[2].data = [...graficoPV.data.datasets[0].data];

            // Duplicar en memoria el array local para conservar cálculos de la tabla frozen
            datosCurvaIV_Frozen = [...datosCurvaIV];

            // Calcular y mover los parámetros numéricos a la fila Frozen de la tabla
            calcularYMostrarParametros(datosCurvaIV_Frozen, 'frozen');

            // Limpiar las curvas activas locales, del gráfico y resetear tabla 'viva'
            datosCurvaIV = [];
            datosCurvaPV = [];
            graficoIV.data.datasets[0].data = [];
            graficoPV.data.datasets[0].data = [];
            calcularYMostrarParametros([], 'viva');

            // Refrescar render en pantalla
            graficoIV.update();
            graficoPV.update();
            console.log("Curva guardada en memoria estática secundaria (gris) y parámetros volcados a Frozen.");
        });
    }

    // Escuchador de Acción: CLEAR CURVE (MODIFICADO - Resetea también tablas)
    if (botonClear) {
        botonClear.addEventListener('click', () => {
            // Vaciar todas las colecciones de datos (Activas, Puntos de operación en vivo y Congeladas)
            datosCurvaIV = [];
            datosCurvaPV = [];
            datosCurvaIV_Frozen = [];

            graficoIV.data.datasets[0].data = []; // I-V Curve
            graficoIV.data.datasets[1].data = []; // Operating Point
            graficoIV.data.datasets[2].data = []; // Frozen Curve

            graficoPV.data.datasets[0].data = []; // P-V Curve
            graficoPV.data.datasets[1].data = []; // Operating Point
            graficoPV.data.datasets[2].data = []; // Frozen Curve

            // Limpiar los textos paramétricos de ambas filas en la tabla
            calcularYMostrarParametros([], 'viva');
            calcularYMostrarParametros([], 'frozen');

            // Forzar actualización total
            graficoIV.update();
            graficoPV.update();
            console.log("Gráficos y tablas reseteados por completo a su estado inicial.");
        });
    }

    // Escuchador de Acción: DOWNLOAD CSV (NUEVO)
    if (botonDownloadCSV) {
        botonDownloadCSV.addEventListener('click', () => {
            if (!datosCurvaIV || datosCurvaIV.length === 0) {
                alert("No hay datos de curvas disponibles para descargar. Realiza un barrido primero.");
                return;
            }

            let csvContent = "data:text/csv;charset=utf-8,";
            csvContent += "Voltage (V),Current (A),Power (W)\n";

            datosCurvaIV.forEach((punto) => {
                const v = punto.x.toFixed(4);
                const i = punto.y.toFixed(4);
                const p = (punto.x * punto.y).toFixed(4);
                csvContent += `${v},${i},${p}\n`;
            });

            const encodedUri = encodeURI(csvContent);
            const linkDescarga = document.createElement("a");
            linkDescarga.setAttribute("href", encodedUri);
            
            const timestamp = new Date().toISOString().slice(0,19).replace(/:/g, "-");
            linkDescarga.setAttribute("download", `IV_Curve_Data_${timestamp}.csv`);
            
            document.body.appendChild(linkDescarga);
            linkDescarga.click();
            document.body.removeChild(linkDescarga);
            console.log("Archivo CSV generado y descargado con éxito.");
        });
    }

    // PROCESADOR Y FORMATEADOR DE CURVAS DESACOPLADAS (MODIFICADO)
    function procesarYGraficarCurvas(lineas) {
        let nuevosPuntosIV = [];
        let nuevosPuntosPV = [];

        for (let i = 0; i < lineas.length; i++) {
            const tokens = lineas[i].split(',');
            if (tokens.length === 2) {
                const vRaw = parseFloat(tokens[0]);
                const iRaw = parseFloat(tokens[1]);

                if (!isNaN(vRaw) && !isNaN(iRaw)) {
                    const vCalibrado = (vRaw * calibracion.V_IN_m) + calibracion.V_IN_n;
                    const iCalibrado = (iRaw * calibracion.I_IN_m) + calibracion.I_IN_n;
                    const pCalculada = vCalibrado * iCalibrado;

                    nuevosPuntosIV.push({ x: vCalibrado, y: iCalibrado });
                    nuevosPuntosPV.push({ x: vCalibrado, y: pCalculada });
                }
            }
        }

        nuevosPuntosIV.sort((a, b) => a.x - b.x);
        nuevosPuntosPV.sort((a, b) => a.x - b.x);

        datosCurvaIV = nuevosPuntosIV;
        datosCurvaPV = nuevosPuntosPV;

        graficoIV.data.datasets[0].data = datosCurvaIV;
        graficoPV.data.datasets[0].data = datosCurvaPV;

        // Calcular y pintar parámetros dinámicos de la curva viva inmediatamente
        calcularYMostrarParametros(datosCurvaIV, 'viva');

        graficoIV.update();
        graficoPV.update();
    }

    // 4. LÓGICA DINÁMICA DEL SLIDER PRINCIPAL Y COMANDOS BINARIOS
    const configModos = {
        MODO1: { habilitado: true,  min: 0,  max: 400, step: 5,  unidad: "W",  texto: "MPPT (Max Power Limit):",   byteModo: 0xB1, init: 500 }, 
        MODO2: { habilitado: true,  min: 10, max: 50,  step: 1,  unidad: "V",  texto: "Setpoint (Input Voltage):",    byteModo: 0xB2, init: 50 },  
        MODO3: { habilitado: true,  min: 0,  max: 100, step: 1,  unidad: "%",  texto: "Setpoint (Duty Cycle):",       byteModo: 0xB3, init: 0 },
    };

    async function enviarComandoBinario() {
        if (!connectedCharacteristic || modoBarridoActivo) return;

        const modoActual = selectorModo.value;
        const config = configModos[modoActual];
        if (!config) return;

        const valorSlider = parseFloat(barraFijarVal.value) || 0;
        let valorRaw16 = 0;

        if (modoActual === 'MODO1') {
            valorRaw16 = Math.round(valorSlider * 84);
        } 
        else if (modoActual === 'MODO2') {
            valorRaw16 = Math.round((valorSlider - calibracion.V_IN_n) / calibracion.V_IN_m);
        } 
        else if (modoActual === 'MODO3') {
            valorRaw16 = Math.round(valorSlider * 12);
        }

        if (valorRaw16 < 0) valorRaw16 = 0;
        if (valorRaw16 > 65535) valorRaw16 = 65535;

        const msb = (valorRaw16 >> 8) & 0xFF;
        const lsb = valorRaw16 & 0xFF;

        const tramaComando = new Uint8Array([0xAA, config.byteModo, msb, lsb]);

        try {
            await connectedCharacteristic.writeValue(tramaComando);
        } catch (e) {
            console.warn("Error sending binary command", e);
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
        barraFijarVal.value = config.init; 

        actualizarTextoSlider(config.texto, config.init, config.unidad);
    }

    function actualizarTextoSlider(textoLabel, valor, unidad) {
        labelSlider.innerHTML = `${textoLabel} <span id="valorSliderText">${valor}</span>${unidad}`;
    }

    if (selectorModo && barraFijarVal) {
        selectorModo.addEventListener('change', async () => {
            actualizarSliderDinámico();
            await enviarComandoBinario();
        });

        barraFijarVal.addEventListener('input', () => {
            const spanValor = document.getElementById('valorSliderText');
            if (spanValor) spanValor.innerText = barraFijarVal.value;
        });

        barraFijarVal.addEventListener('change', async () => {
            await enviarComandoBinario();
        });

        actualizarSliderDinámico();
    }

    // 5. CONTROL DEL MODAL DE CONFIGURACIÓN AMPLIADO (CALIBRACIÓN + GRÁFICAS)
    const botonConfig = document.getElementById('botonConfig');
    const modalConfig = document.getElementById('modalConfig');
    const btnGuardarCal = document.getElementById('botonGuardarConfig');
    const btnCancelarCal = document.getElementById('botonCerrarConfig');

    // Escuchar cambios en vivo del slider del modal
    if (cfgPuntosBarrido && cfgPuntosBarridoText) {
        cfgPuntosBarrido.addEventListener('input', () => {
            cfgPuntosBarridoText.innerText = `${cfgPuntosBarrido.value} pts`;
        });
    }

    if (botonConfig && modalConfig) {
        botonConfig.addEventListener('click', () => {
            // Cargar valores de calibración en los inputs
            document.getElementById('cal_c1').value = calibracion.V_IN_m;
            document.getElementById('cal_c2').value = calibracion.V_IN_n;
            document.getElementById('cal_c3').value = calibracion.I_IN_m;
            document.getElementById('cal_c4').value = calibracion.I_IN_n;
            document.getElementById('cal_c5').value = calibracion.V_OUT_m;
            document.getElementById('cal_c6').value = calibracion.V_OUT_n;
            document.getElementById('cal_c7').value = calibracion.I_OUT_m;
            document.getElementById('cal_c8').value = calibracion.I_OUT_n;
            
            // Cargar valores de ejes y barrido en los selectores/slider
            if (cfgMaxVoltaje) cfgMaxVoltaje.value = limitesGraficas.maxVoltaje;
            if (cfgMaxCorriente) cfgMaxCorriente.value = limitesGraficas.maxCorriente;
            if (cfgMaxPotencia) cfgMaxPotencia.value = limitesGraficas.maxPotencia;
            if (cfgPuntosBarrido) {
                cfgPuntosBarrido.value = puntosBarridoConfig;
                cfgPuntosBarridoText.innerText = `${puntosBarridoConfig} pts`;
            }

            modalConfig.style.display = 'flex';
        });

        btnCancelarCal.addEventListener('click', () => {
            modalConfig.style.display = 'none';
        });

        btnGuardarCal.addEventListener('click', () => {
            // 1. Guardar constantes de calibración
            calibracion.V_IN_m = parseFloat(document.getElementById('cal_c1').value) || 0.0;
            calibracion.V_IN_n = parseFloat(document.getElementById('cal_c2').value) || 0.0;
            calibracion.I_IN_m = parseFloat(document.getElementById('cal_c3').value) || 0.0;
            calibracion.I_IN_n = parseFloat(document.getElementById('cal_c4').value) || 0.0;
            calibracion.V_OUT_m = parseFloat(document.getElementById('cal_c5').value) || 0.0;
            calibracion.V_OUT_n = parseFloat(document.getElementById('cal_c6').value) || 0.0;
            calibracion.I_OUT_m = parseFloat(document.getElementById('cal_c7').value) || 0.0;
            calibracion.I_OUT_n = parseFloat(document.getElementById('cal_c8').value) || 0.0;
            
            // 2. Guardar límites de gráficas y puntos desde el DOM
            if (cfgMaxVoltaje) limitesGraficas.maxVoltaje = parseInt(cfgMaxVoltaje.value, 10);
            if (cfgMaxCorriente) limitesGraficas.maxCorriente = parseInt(cfgMaxCorriente.value, 10);
            if (cfgMaxPotencia) limitesGraficas.maxPotencia = parseInt(cfgMaxPotencia.value, 10);
            if (cfgPuntosBarrido) puntosBarridoConfig = parseInt(cfgPuntosBarrido.value, 10);

            // 3. PERSISTENCIA EN LOCALSTORAGE (Para que no se borre al recargar)
            localStorage.setItem('pv_calibracion', JSON.stringify(calibracion));
            localStorage.setItem('pv_limites_graficas', JSON.stringify(limitesGraficas));
            localStorage.setItem('pv_puntos_barrido', puntosBarridoConfig.toString());

            // 4. APLICAR ESCALAS EN TIEMPO REAL A CHART.JS
            graficoIV.options.scales.x.max = limitesGraficas.maxVoltaje;
            graficoIV.options.scales.y.max = limitesGraficas.maxCorriente;
            
            graficoPV.options.scales.x.max = limitesGraficas.maxVoltaje;
            graficoPV.options.scales.y.max = limitesGraficas.maxPotencia;

            // Refrescar vistas de los charts de inmediato
            graficoIV.update();
            graficoPV.update();

            modalConfig.style.display = 'none';
        });
    }
  });
}

// Guard contra inicialización doble y espera al DOM
if (!window.__ivvisualizer_initialized) {
  window.__ivvisualizer_initialized = true;

  document.addEventListener('DOMContentLoaded', () => {
    const botonConectar = document.getElementById('botonConectar');
    const botonSolicitarIV = document.getElementById('botonSolicitarIV');
    const botonLED = document.getElementById('botonLED');
    const botonDescargarCSV = document.getElementById('botonDescargarCSV');
    const ledIndicator = document.getElementById('ledIndicator');
    const canvasEl = document.getElementById('graficoIV');
    if (!canvasEl) return; // nada que hacer si no existe el canvas
    const ctx = canvasEl.getContext('2d');

    const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
    const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

    // const SERVICE_UUID = "0000ffe0-0000-1000-8000-00805f9b34fb";          // Nuevos ID para modulo HM-10
    // const CHARACTERISTIC_UUID = "0000ffe1-0000-1000-8000-00805f9b34fb";   // Nuevos ID para modulo HM-10

    // Detectar disponibilidad de la API Web Bluetooth
    const hasWebBluetooth = !!(navigator && navigator.bluetooth && typeof navigator.bluetooth.requestDevice === 'function');
    if (!hasWebBluetooth) {
      console.warn('Web Bluetooth API no disponible en este navegador/contexto');
      if (botonConectar) {
        botonConectar.disabled = true;
        botonConectar.innerText = 'Bluetooth no soportado';
        botonConectar.title = 'Usa Chrome/Edge en localhost o HTTPS; Web Bluetooth no disponible';
      }
      if (botonSolicitarIV) botonSolicitarIV.disabled = true;
      if (botonLED) botonLED.disabled = true;
      if (ledIndicator) {
        ledIndicator.classList.remove('on');
        ledIndicator.classList.add('off');
      }
    }

    // 1. Inicializar el gráfico vacío
    let datosCurva = [];
    const graficoIV = new Chart(ctx, {
        type: 'line',
        data: {
            datasets: [{
                label: 'IV-Curve',
                data: datosCurva,
                borderColor: '#ffca28',
                backgroundColor: 'rgba(255, 202, 40, 0.1)',
                borderWidth: 3,
          tension: 0.4,
          pointRadius: 3,
          pointHoverRadius: 6,
          hitRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
        animation: { duration: 0 },
        elements: { point: { radius: 3 } },
        interaction: { mode: 'nearest', intersect: true },
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Voltage (V)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' } },
                y: { title: { display: true, text: 'Current (A)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: 6 }
            },
        plugins: {
          legend: { labels: { color: '#fff' } },
          tooltip: {
            enabled: true,
            callbacks: {
              label: function(context) {
                const x = context.parsed.x;
                const y = context.parsed.y;
                if (x == null || y == null) return '';
                return `V: ${x.toFixed(2)} V, I: ${y.toFixed(3)} A`;
              }
            }
          }
        }
        }
    });

    // Buffer for incoming points and throttled flush to Chart.js
    const puntosBuffer = [];
    const MAX_POINTS = 2000; // cap stored points to avoid slowdowns
    const FLUSH_INTERVAL_MS = 15; // update chart at most every 100ms

    function flushBufferToChart() {
      if (puntosBuffer.length === 0) return;
      // append buffered points
      datosCurva.push(...puntosBuffer.splice(0, puntosBuffer.length));
      // enforce max length
      if (datosCurva.length > MAX_POINTS) {
      datosCurva.splice(0, datosCurva.length - MAX_POINTS);
      }
      // update chart without animation
      try { graficoIV.update('none'); } catch (e) { console.warn('Chart update failed', e); }
      // enable CSV button if there is data
      try { if (botonDescargarCSV) botonDescargarCSV.disabled = (datosCurva.length === 0); } catch (e) {}
    }

    // Periodic flush
    const flushTimer = setInterval(flushBufferToChart, FLUSH_INTERVAL_MS);

    // 2. Lógica de conexión Bluetooth (si existe el botón y la API está disponible)
    let connectedCharacteristic = null;
    let connectedDevice = null;
    let connectedServer = null;
    let ledOn = false;

    if (botonConectar && hasWebBluetooth) {
      botonConectar.addEventListener('click', async () => {
        try {
          // si ya estamos conectados, usamos el mismo botón para desconectar y apagar LED
          if (connectedDevice && connectedDevice.gatt && connectedDevice.gatt.connected) {
            try {
              if (connectedCharacteristic) {
                // intentar apagar el LED en el dispositivo antes de desconectar
                try { await connectedCharacteristic.writeValue(new TextEncoder().encode('LED_OFF')); } catch (e) { /* ignore */ }
              }
            } catch (e) {}
            try { connectedDevice.gatt.disconnect(); } catch (e) {}
            connectedDevice = null; connectedServer = null; connectedCharacteristic = null;
            botonConectar.innerText = 'Connect Bluetooth';
            botonConectar.style.background = '';
            if (botonSolicitarIV) botonSolicitarIV.disabled = true;
            if (botonLED) { botonLED.disabled = true; botonLED.innerText = 'Encender LED'; }
            if (ledIndicator) { ledIndicator.classList.remove('on'); ledIndicator.classList.add('off'); }
            return;
          }

          const device = await navigator.bluetooth.requestDevice({ filters: [{ name: 'ESP32_Web_BLE' }], optionalServices: [SERVICE_UUID] });

          const server = await device.gatt.connect();
          const service = await server.getPrimaryService(SERVICE_UUID);
          const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
          connectedCharacteristic = characteristic; // exponer para escritura desde otros botones
          connectedDevice = device; connectedServer = server;

          // habilitar botones de acción una vez conectados
          if (botonSolicitarIV) botonSolicitarIV.disabled = false;
          if (botonLED) {
            botonLED.disabled = false;
            botonLED.innerText = ledOn ? 'Apagar LED' : 'Encender LED';
            botonLED.style.background = ledOn ? "#2196f3" : "";
          }

          botonConectar.innerText = "⚡ Connected (click to disconnect)";
          botonConectar.style.background = "#2196f3";

          // Leer estado inicial del dispositivo (p. ej. LED_ON / LED_OFF) para sincronizar UI
          try {
            try {
              const initial = await connectedCharacteristic.readValue();
              const decodedInitial = new TextDecoder('utf-8').decode(initial);
              const texto = (decodedInitial || '').trim().toUpperCase();
              if (texto.indexOf('LED_ON') !== -1) { ledOn = true; }
              else if (texto.indexOf('LED_OFF') !== -1) { ledOn = false; }
            } catch (e) {
              console.warn('No se pudo leer estado inicial desde la característica', e);
            }
            if (botonLED) {
              botonLED.innerText = ledOn ? 'Apagar LED' : 'Encender LED';
              botonLED.style.background = ledOn ? "#2196f3" : "";
            }
            if (ledIndicator) {
              ledIndicator.classList.toggle('on', ledOn);
              ledIndicator.classList.toggle('off', !ledOn);
            }
          } catch (e) {
            console.warn('No se pudo leer estado inicial desde la característica', e);
          }

          await characteristic.startNotifications();
          
          characteristic.addEventListener('characteristicvaluechanged', (event) => {
            const value = event.target.value;
            let textoDecodificado = '';
            try { textoDecodificado = new TextDecoder('utf-8').decode(value); } catch (e) { textoDecodificado = ''; }
            textoDecodificado = (textoDecodificado || '').trim();

            // Mensaje IV esperado como CSV "Voltaje,Corriente"
            if (textoDecodificado.includes(',')) {
              const partes = textoDecodificado.split(',');
              const v = parseFloat(partes[0]);
              const i = parseFloat(partes[1]);

              // Si detectamos que reinició el barrido (voltaje vuelve a 0), limpiamos buffer y gráfica
              if (v === 0 && (datosCurva.length + puntosBuffer.length) > 5) {
                datosCurva.length = 0;
                puntosBuffer.length = 0;
                if (graficoIV && graficoIV.data && graficoIV.data.datasets && graficoIV.data.datasets[0]) {
                  graficoIV.data.datasets[0].data.length = 0;
                  try { graficoIV.update('none'); } catch (e) {}
                }
              }

              // Añadimos el nuevo punto al buffer en lugar de forzar una actualización inmediata
              puntosBuffer.push({ x: v, y: i });

              // Actualizar displays en la UI con los últimos valores (no toca redibujar todo)
              try {
                const voltageEl = document.getElementById('voltageValue');
                const currentEl = document.getElementById('currentValue');
                if (voltageEl) voltageEl.innerText = isNaN(v) ? '-' : v.toFixed(2);
                if (currentEl) currentEl.innerText = isNaN(i) ? '-' : i.toFixed(3);
              } catch (e) {
                // no hacer nada si DOM no está disponible
              }
            } else {
              // Mensajes de estado como LED_ON / LED_OFF
              const t = textoDecodificado.toUpperCase();
                if (t.indexOf('LED_ON') !== -1) {
                ledOn = true;
                if (botonLED) { botonLED.innerText = 'Apagar LED'; botonLED.style.background = "#2196f3"; }
                if (ledIndicator) { ledIndicator.classList.add('on'); ledIndicator.classList.remove('off'); }
              } else if (t.indexOf('LED_OFF') !== -1) {
                ledOn = false;
                if (botonLED) { botonLED.innerText = 'Encender LED'; botonLED.style.background = ""; }
                if (ledIndicator) { ledIndicator.classList.add('off'); ledIndicator.classList.remove('on'); }
              } else {
                console.log('Notificación no reconocida:', textoDecodificado);
              }
            }
          });

        } catch (error) {
          console.error(error);
          botonConectar.innerText = "Error de conexión";
          botonConectar.style.background = "#f44336";
        }
      });
    } else if (botonConectar && !hasWebBluetooth) {
      // Opcional: explicar por qué no funciona si el usuario pulsa (mismo texto que el tooltip)
      botonConectar.addEventListener('click', () => {
        alert('Web Bluetooth no está disponible en este navegador.\nUsa Google Chrome o Edge en localhost (http://localhost) o sirve la página sobre HTTPS.\nRevisa: chrome://flags/#enable-experimental-web-platform-features si es necesario.');
      });
    }

    // Acciones de los nuevos botones (envío de comandos a la característica BLE)
    if (botonSolicitarIV) {
      botonSolicitarIV.addEventListener('click', async () => {
        if (!connectedCharacteristic) return alert('No conectado');
        try {
          await connectedCharacteristic.writeValue(new TextEncoder().encode('GET_IV'));
        } catch (err) {
          console.error('Error enviando GET_IV', err);
          alert('Error al solicitar IV');
        }
      });
    }

    if (botonLED) {
      botonLED.addEventListener('click', async () => {
        if (!connectedCharacteristic) return alert('No conectado');
        try {
          const cmd = ledOn ? 'LED_OFF' : 'LED_ON';
          await connectedCharacteristic.writeValue(new TextEncoder().encode(cmd));
          // Intentar leer estado confirmado por el dispositivo; si falla, cambiar estado localmente
          try {
            const resp = await connectedCharacteristic.readValue();
            const decoded = new TextDecoder('utf-8').decode(resp || resp.buffer || resp);
            const t = (decoded || '').trim().toUpperCase();
            if (t.indexOf('LED_ON') !== -1) ledOn = true;
            else if (t.indexOf('LED_OFF') !== -1) ledOn = false;
            else ledOn = !ledOn; // fallback
          } catch (e) {
            // si no se pudo leer, invertimos el estado local como indicación inmediata
            ledOn = !ledOn;
          }
          botonLED.innerText = ledOn ? 'Apagar LED' : 'Encender LED';
          botonLED.style.background = ledOn ? "#2196f3" : "";
          if (ledIndicator) { ledIndicator.classList.toggle('on', ledOn); ledIndicator.classList.toggle('off', !ledOn); }
        } catch (err) {
          console.error('Error toggling LED', err);
          alert('Error al cambiar estado del LED');
        }
      });
    }

    // Descargar CSV con todos los puntos actualmente en memoria (datos confirmados + buffer)
    if (botonDescargarCSV) {
      botonDescargarCSV.disabled = true; // inicialmente sin datos
      botonDescargarCSV.addEventListener('click', () => {
        const points = [].concat(datosCurva, puntosBuffer);
        if (!points || points.length === 0) return alert('No hay datos para exportar');
        const rows = ['Voltage,Current'];
        for (const p of points) {
          // proteger si p tiene propiedades distintas
          const vx = (p && typeof p.x === 'number') ? p.x : (p && p[0] ? p[0] : '');
          const vy = (p && typeof p.y === 'number') ? p.y : (p && p[1] ? p[1] : '');
          rows.push(`${vx},${vy}`);
        }
        const csv = rows.join('\r\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const ts = new Date().toISOString().replace(/[:.]/g, '-');
        a.download = `iv_curve_${ts}.csv`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      });
    }
  });
}

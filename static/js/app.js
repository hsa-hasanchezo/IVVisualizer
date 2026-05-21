// Guard contra inicialización doble y espera al DOM
if (!window.__ivvisualizer_initialized) {
  window.__ivvisualizer_initialized = true;

  document.addEventListener('DOMContentLoaded', () => {
    const botonConectar = document.getElementById('botonConectar');
    const botonSolicitarIV = document.getElementById('botonSolicitarIV');
    const botonLED = document.getElementById('botonLED');
    const ledIndicator = document.getElementById('ledIndicator');
    const canvasEl = document.getElementById('graficoIV');
    if (!canvasEl) return; // nada que hacer si no existe el canvas
    const ctx = canvasEl.getContext('2d');

    const SERVICE_UUID = "4fafc201-1fb5-459e-8fcc-c5c9c331914b";
    const CHARACTERISTIC_UUID = "beb5483e-36e1-4688-b7f5-ea07361b26a8";

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
                pointRadius: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { type: 'linear', position: 'bottom', title: { display: true, text: 'Voltage (V)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' } },
                y: { title: { display: true, text: 'Current (A)', color: '#fff' }, grid: { color: '#444' }, ticks: { color: '#fff' }, min: 0, max: 6 }
            },
            plugins: { legend: { labels: { color: '#fff' } } }
        }
    });

    // 2. Lógica de conexión Bluetooth (si existe el botón y la API está disponible)
    let connectedCharacteristic = null;
    let ledOn = false;

    if (botonConectar && hasWebBluetooth) {
      botonConectar.addEventListener('click', async () => {
        try {
          const device = await navigator.bluetooth.requestDevice({
            filters: [{ name: 'ESP32_Web_BLE' }],
            optionalServices: [SERVICE_UUID]
          });

          const server = await device.gatt.connect();
          const service = await server.getPrimaryService(SERVICE_UUID);
          const characteristic = await service.getCharacteristic(CHARACTERISTIC_UUID);
          connectedCharacteristic = characteristic; // exponer para escritura desde otros botones

          // habilitar botones de acción una vez conectados
          if (botonSolicitarIV) botonSolicitarIV.disabled = false;
          if (botonLED) {
            botonLED.disabled = false;
            botonLED.innerText = ledOn ? 'Apagar LED' : 'Encender LED';
          }

          botonConectar.innerText = "⚡ Connected";
          botonConectar.style.background = "#2196f3";

          // Leer estado inicial del dispositivo (p. ej. LED_ON / LED_OFF) para sincronizar UI
          try {
            const initial = await connectedCharacteristic.readValue();
            const texto = new TextDecoder().decode(initial.buffer ? initial.buffer : initial);
            if (texto.indexOf('LED_ON') !== -1) {
              ledOn = true;
            } else if (texto.indexOf('LED_OFF') !== -1) {
              ledOn = false;
            }
            if (botonLED) botonLED.innerText = ledOn ? 'Apagar LED' : 'Encender LED';
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
            const textoDecodificado = new TextDecoder('utf-8').decode(value);

            // Mensaje IV esperado como CSV "Voltaje,Corriente"
            if (textoDecodificado.includes(',')) {
              const partes = textoDecodificado.split(',');
              const v = parseFloat(partes[0]);
              const i = parseFloat(partes[1]);

              // Si detectamos que reinició el barrido (voltaje vuelve a 0), limpiamos la gráfica
              if (v === 0 && datosCurva.length > 5) {
                datosCurva.length = 0; 
              }

              // Añadimos el nuevo punto al formato {x, y} que entiende Chart.js
              datosCurva.push({ x: v, y: i });
              // Refrescamos el gráfico
              graficoIV.update('none'); 
            } else {
              // Mensajes de estado como LED_ON / LED_OFF
              if (textoDecodificado.indexOf('LED_ON') !== -1) {
                ledOn = true;
                if (botonLED) botonLED.innerText = 'Apagar LED';
                if (ledIndicator) { ledIndicator.classList.add('on'); ledIndicator.classList.remove('off'); }
              } else if (textoDecodificado.indexOf('LED_OFF') !== -1) {
                ledOn = false;
                if (botonLED) botonLED.innerText = 'Encender LED';
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
          ledOn = !ledOn;
          botonLED.innerText = ledOn ? 'Apagar LED' : 'Encender LED';
          if (ledIndicator) { ledIndicator.classList.toggle('on', ledOn); ledIndicator.classList.toggle('off', !ledOn); }
        } catch (err) {
          console.error('Error toggling LED', err);
          alert('Error al cambiar estado del LED');
        }
      });
    }
  });
}
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLECharacteristic *pCharacteristic;
bool deviceConnected = false;
bool sendIVRequested = false; // Cuando se recibe GET_IV, se activa
bool ledState = false;

// Helper para cambiar el estado del LED y notificar al cliente
void setLed(bool on) {
  ledState = on;
  digitalWrite(LED_BUILTIN, on ? HIGH : LOW);
  if (pCharacteristic) {
    pCharacteristic->setValue(on ? "LED_ON" : "LED_OFF");
    pCharacteristic->notify();
  }
}

// Variables para la simulación de la curva I-V
const float Voc = 21.0;        // Voltaje Circuito Abierto (Voltios)
const float Isc = 5.0;         // Corriente Cortocircuito (Amperios)
float voltajeActual = 0.0;
const float pasoVoltaje = 0.5; // Incremento en cada punto

// Clase para manejar los mensajes que RECIBE el ESP32 desde la Web
class MyCharacteristicCallbacks: public BLECharacteristicCallbacks {
  public:
    void onWrite(BLECharacteristic *pCharacteristic) override {
      // Obtener el valor directamente como Arduino String (compatible con la librería ESP32 BLE)
      String value = pCharacteristic->getValue();
      if (value.length() > 0) {
        Serial.print("Mensaje recibido desde la Web: ");
        Serial.println(value);

        // Interpretar comandos simples
        if (value.equals("GET_IV")) {
          sendIVRequested = true;
          Serial.println("Comando: GET_IV -> Enviando curva I-V (una vez)");
        } else if (value.equals("LED_ON")) {
          setLed(true);
          Serial.println("Comando: LED_ON -> LED encendido");
        } else if (value.equals("LED_OFF")) {
          setLed(false);
          Serial.println("Comando: LED_OFF -> LED apagado");
        } else if (value.equals("LED_TOGGLE")) {
          setLed(!ledState);
          Serial.println("Comando: LED_TOGGLE -> LED cambiado");
        } else if (value.equals("GET_LED") || value.equals("LED?")) {
          // Responder con el estado actual sin cambiarlo
          if (pCharacteristic) {
            pCharacteristic->setValue(ledState ? "LED_ON" : "LED_OFF");
            pCharacteristic->notify();
          }
        } else {
          Serial.println("Comando desconocido");
        }
      }
    }
};

// Clase para saber si la web se conectó o desconectó
class MyServerCallbacks: public BLEServerCallbacks {
  public:
    void onConnect(BLEServer* pServer) override {
      deviceConnected = true;
      Serial.println("¡Web app conectada!");
    }

    void onDisconnect(BLEServer* pServer) override {
      deviceConnected = false;
      voltajeActual = 0.0; // Reiniciamos el barrido para la próxima conexión
      Serial.println("Web app desconectada. Reiniciando publicidad...");
      pServer->startAdvertising(); 
    }
};

void setup() {
  Serial.begin(115200);
  Serial.println("Iniciando configuración BLE...");

  // Inicializar pin LED (usar LED integrado)
  pinMode(LED_BUILTIN, OUTPUT);
  digitalWrite(LED_BUILTIN, LOW);

  // 1. Inicializar el dispositivo BLE
  BLEDevice::init("ESP32_Web_BLE");

  // 2. Crear el Servidor BLE y asignar Callbacks
  BLEServer *pServer = BLEDevice::createServer();
  pServer->setCallbacks(new MyServerCallbacks());

  // 3. Crear el Servicio BLE
  BLEService *pService = pServer->createService(SERVICE_UUID);

  // 4. Crear la Característica con permisos de Lectura, Escritura y Notificación
  pCharacteristic = pService->createCharacteristic(
                      CHARACTERISTIC_UUID,
                      BLECharacteristic::PROPERTY_READ   |
                      BLECharacteristic::PROPERTY_WRITE  |
                      BLECharacteristic::PROPERTY_NOTIFY
                    );

  // Asignar los callbacks de la característica y el descriptor necesario para Notificaciones
  pCharacteristic->setCallbacks(new MyCharacteristicCallbacks());
  pCharacteristic->addDescriptor(new BLE2902());

  // Inicializar valor de la característica con el estado del LED
  pCharacteristic->setValue("LED_OFF");

  // 5. Iniciar el servicio y comenzar a emitir señal (Advertising)
  pService->start();
  BLEAdvertising *pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  pAdvertising->setMinPreferred(0x06);  
  pAdvertising->setMinPreferred(0x12);
  BLEDevice::startAdvertising();
  
  Serial.println("¡ESP32 listo y esperando conexión web!");
}

void loop() {
  // Solo enviar la curva cuando se solicite explícitamente con GET_IV
  if (deviceConnected && sendIVRequested) {
    // Enviar un barrido completo de la curva I-V una sola vez
    float exponente = 5.0;
    while (voltajeActual <= Voc + 1.0 && deviceConnected) {
      float corriente = Isc * (1.0 - pow((voltajeActual / Voc), exponente));
      if (corriente < 0) corriente = 0;

      String datosEnvio = String(voltajeActual, 2) + "," + String(corriente, 2);
      pCharacteristic->setValue(datosEnvio.c_str());
      pCharacteristic->notify();

      Serial.println("Enviado -> V: " + String(voltajeActual) + "V | I: " + String(corriente) + "A");

      voltajeActual += pasoVoltaje;
      delay(150); // intervalo entre puntos
    }

    // Fin del barrido: resetear estado y voltaje para la próxima petición
    voltajeActual = 0.0;
    sendIVRequested = false;
    Serial.println("--- Barrido I-V completado ---");
  }
}
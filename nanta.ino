// ============================================================
// Sistem Deteksi Arus Bocor — Arduino Uno (jembatan FPGA <-> Web)
// FPGA Spartan-6 + ADS1115 (4 channel) --UART--> Arduino --USB--> Web
//
// FPGA -> Arduino (SoftwareSerial pin 2): "+CH0,+CH1,+CH2,+CH3\r\n"
//
// Arduino -> Web (USB Serial):
//   D,<ch>,<raw>              data channel terpilih
//   C,<ch>,<min>,<max>,<sens> balasan kalibrasi EEPROM
//   OK,<msg>                  ack
//
// Web -> Arduino:
//   SEL:<ch>                  pilih channel yang di-stream (0..3)
//   SAVE:<ch>,<min>,<max>,<sens>  simpan kalibrasi ke EEPROM
//   GET:<ch>                  minta kalibrasi tersimpan
// ============================================================

#include <SoftwareSerial.h>
#include <EEPROM.h>

SoftwareSerial fpgaSerial(2, 3);   // RX=2 (dari FPGA), TX=3 (tidak dipakai)

const uint8_t  EEPROM_MAGIC      = 0x5A;
const int      EEPROM_MAGIC_ADDR = 0;
const int      EEPROM_BASE       = 1;       // data kalibrasi mulai di addr 1
const int      CAL_SIZE          = 5;       // int16 min + int16 max + uint8 sens

int selectedCh = 0;

// Buffer baris
String fpgaLine = "";
String usbLine  = "";

struct Calib { int16_t minVal; int16_t maxVal; uint8_t sens; };

int calAddr(int ch) { return EEPROM_BASE + ch * CAL_SIZE; }

void writeCalib(int ch, int16_t mn, int16_t mx, uint8_t sens) {
  int a = calAddr(ch);
  EEPROM.put(a, mn);
  EEPROM.put(a + 2, mx);
  EEPROM.update(a + 4, sens);
}

Calib readCalib(int ch) {
  Calib c;
  int a = calAddr(ch);
  EEPROM.get(a, c.minVal);
  EEPROM.get(a + 2, c.maxVal);
  c.sens = EEPROM.read(a + 4);
  return c;
}

void initEepromIfNeeded() {
  if (EEPROM.read(EEPROM_MAGIC_ADDR) != EEPROM_MAGIC) {
    for (int ch = 0; ch < 4; ch++) writeCalib(ch, 0, 0, 50); // default sens 50%
    EEPROM.update(EEPROM_MAGIC_ADDR, EEPROM_MAGIC);
  }
}

void setup() {
  Serial.begin(9600);        // ke PC / Web via USB
  fpgaSerial.begin(9600);    // dari FPGA
  initEepromIfNeeded();
  Serial.println(F("OK,Arduino ready (leak-detection bridge)"));
}

// Parse frame "+CH0,+CH1,+CH2,+CH3", kirim hanya channel terpilih
void handleFpgaLine(const String &line) {
  long vals[4];
  int idx = 0;
  int start = 0;
  for (int i = 0; i <= line.length() && idx < 4; i++) {
    if (i == line.length() || line[i] == ',') {
      String tok = line.substring(start, i);
      tok.trim();
      vals[idx++] = tok.toInt();   // toInt() menangani tanda + / -
      start = i + 1;
    }
  }
  if (idx == 4) {
    Serial.print(F("D,"));
    Serial.print(selectedCh);
    Serial.print(',');
    Serial.println(vals[selectedCh]);
  }
}

void sendCalib(int ch) {
  Calib c = readCalib(ch);
  Serial.print(F("C,"));
  Serial.print(ch);       Serial.print(',');
  Serial.print(c.minVal); Serial.print(',');
  Serial.print(c.maxVal); Serial.print(',');
  Serial.println(c.sens);
}

void handleCommand(const String &cmd) {
  if (cmd.startsWith("SEL:")) {
    int ch = cmd.substring(4).toInt();
    if (ch >= 0 && ch <= 3) {
      selectedCh = ch;
      Serial.print(F("OK,SEL ")); Serial.println(ch);
    }
  } else if (cmd.startsWith("GET:")) {
    int ch = cmd.substring(4).toInt();
    if (ch >= 0 && ch <= 3) sendCalib(ch);
  } else if (cmd.startsWith("SAVE:")) {
    // SAVE:<ch>,<min>,<max>,<sens>
    String body = cmd.substring(5);
    long f[4]; int idx = 0, start = 0;
    for (int i = 0; i <= body.length() && idx < 4; i++) {
      if (i == body.length() || body[i] == ',') {
        f[idx++] = body.substring(start, i).toInt();
        start = i + 1;
      }
    }
    if (idx == 4) {
      int ch = f[0];
      if (ch >= 0 && ch <= 3) {
        writeCalib(ch, (int16_t)f[1], (int16_t)f[2], (uint8_t)f[3]);
        Serial.print(F("OK,SAVE ")); Serial.println(ch);
        sendCalib(ch);
      }
    }
  }
}

void loop() {
  // Baca frame dari FPGA
  while (fpgaSerial.available()) {
    char ch = fpgaSerial.read();
    if (ch == '\n') {
      fpgaLine.trim();
      if (fpgaLine.length() > 0) handleFpgaLine(fpgaLine);
      fpgaLine = "";
    } else if (ch != '\r') {
      fpgaLine += ch;
      if (fpgaLine.length() > 64) fpgaLine = ""; // guard
    }
  }

  // Baca command dari Web (USB)
  while (Serial.available()) {
    char ch = Serial.read();
    if (ch == '\n') {
      usbLine.trim();
      if (usbLine.length() > 0) handleCommand(usbLine);
      usbLine = "";
    } else if (ch != '\r') {
      usbLine += ch;
      if (usbLine.length() > 64) usbLine = "";
    }
  }
}

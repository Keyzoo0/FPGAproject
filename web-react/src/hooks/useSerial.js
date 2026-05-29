import { useCallback, useEffect, useRef, useState } from 'react';
import { BAUD_RATE } from '../lib/adc.js';

// Connection state machine
export const ConnState = {
  IDLE: 'idle',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  DISCONNECTING: 'disconnecting',
};

export const serialSupported = () => 'serial' in navigator;

/**
 * Hook Web Serial untuk protokol Arduino arus-bocor.
 *
 * Arduino → Web (line, dipisah '\n'):
 *   D,<ch>,<raw>             data channel terpilih
 *   C,<ch>,<min>,<max>,<sens> balasan kalibrasi EEPROM
 *   OK,<msg>                  ack
 *
 * Web → Arduino:
 *   SEL:<ch>
 *   SAVE:<ch>,<min>,<max>,<sens>
 *   GET:<ch>
 */
export function useSerial({ onData, onCalib, onLog } = {}) {
  const [connState, setConnState] = useState(ConnState.IDLE);
  const [error, setError] = useState(null);

  const portRef = useRef(null);
  const readerRef = useRef(null);
  const writerRef = useRef(null);
  const keepReadingRef = useRef(false);
  const readPromiseRef = useRef(null);
  const bufferRef = useRef('');

  // keep latest callbacks without re-binding the read loop
  const cb = useRef({ onData, onCalib, onLog });
  useEffect(() => {
    cb.current = { onData, onCalib, onLog };
  }, [onData, onCalib, onLog]);

  const log = useCallback((line) => cb.current.onLog?.(line), []);

  const handleLine = useCallback((line) => {
    log(line);
    const parts = line.split(',');
    const tag = parts[0];
    if (tag === 'D' && parts.length >= 3) {
      const ch = parseInt(parts[1], 10);
      const raw = parseInt(parts[2], 10);
      if (!Number.isNaN(ch) && !Number.isNaN(raw)) {
        cb.current.onData?.({ ch, raw, t: Date.now() });
      }
    } else if (tag === 'C' && parts.length >= 5) {
      const ch = parseInt(parts[1], 10);
      const min = parseInt(parts[2], 10);
      const max = parseInt(parts[3], 10);
      const sens = parseInt(parts[4], 10);
      if (![ch, min, max, sens].some(Number.isNaN)) {
        cb.current.onCalib?.({ ch, min, max, sens });
      }
    }
  }, [log]);

  const send = useCallback(async (cmd) => {
    const writer = writerRef.current;
    if (!writer) return;
    try {
      await writer.write(new TextEncoder().encode(cmd.endsWith('\n') ? cmd : cmd + '\n'));
      log('» ' + cmd);
    } catch (err) {
      console.error('serial write failed', err);
    }
  }, [log]);

  const readLoop = useCallback(async () => {
    const decoder = new TextDecoder();
    let reader = null;
    try {
      reader = portRef.current.readable.getReader();
      readerRef.current = reader;
      while (keepReadingRef.current) {
        const { value, done } = await reader.read();
        if (done) break;
        bufferRef.current += decoder.decode(value, { stream: true });
        let nl;
        while ((nl = bufferRef.current.indexOf('\n')) !== -1) {
          const line = bufferRef.current.slice(0, nl).replace(/\r$/, '');
          bufferRef.current = bufferRef.current.slice(nl + 1);
          if (line.length > 0) handleLine(line);
        }
      }
    } catch (err) {
      if (keepReadingRef.current) {
        console.error('read loop error', err);
        setError('Koneksi terputus: ' + err.message);
        queueMicrotask(() => forcedDisconnect());
      }
    } finally {
      if (reader) {
        try { reader.releaseLock(); } catch {}
      }
      readerRef.current = null;
    }
  }, [handleLine]);

  const connect = useCallback(async () => {
    if (connState !== ConnState.IDLE) return;
    setError(null);
    setConnState(ConnState.CONNECTING);
    let port = null;
    try {
      port = await navigator.serial.requestPort();
      await port.open({
        baudRate: BAUD_RATE,
        dataBits: 8,
        stopBits: 1,
        parity: 'none',
        flowControl: 'none',
      });
    } catch (err) {
      setError(err.message);
      if (port) { try { await port.close(); } catch {} }
      setConnState(ConnState.IDLE);
      return false;
    }
    portRef.current = port;
    bufferRef.current = '';
    keepReadingRef.current = true;
    writerRef.current = port.writable?.getWriter() ?? null;
    setConnState(ConnState.CONNECTED);
    readPromiseRef.current = readLoop().catch((e) => console.error(e));
    return true;
  }, [connState, readLoop]);

  const cleanup = useCallback(() => {
    portRef.current = null;
    readerRef.current = null;
    writerRef.current = null;
    bufferRef.current = '';
    keepReadingRef.current = false;
    readPromiseRef.current = null;
    setConnState(ConnState.IDLE);
  }, []);

  const disconnect = useCallback(async () => {
    if (connState !== ConnState.CONNECTED) return;
    setConnState(ConnState.DISCONNECTING);
    keepReadingRef.current = false;
    if (writerRef.current) {
      try { writerRef.current.releaseLock(); } catch {}
    }
    if (readerRef.current) {
      try { await readerRef.current.cancel(); } catch {}
    }
    if (readPromiseRef.current) {
      try {
        await Promise.race([
          readPromiseRef.current,
          new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
        ]);
      } catch {}
    }
    if (portRef.current) {
      try { await portRef.current.close(); } catch {}
    }
    cleanup();
  }, [connState, cleanup]);

  function forcedDisconnect() {
    if (keepReadingRef.current === false && !portRef.current) return;
    keepReadingRef.current = false;
    if (writerRef.current) { try { writerRef.current.releaseLock(); } catch {} }
    if (readerRef.current) { try { readerRef.current.cancel().catch(() => {}); } catch {} }
    if (portRef.current) { try { portRef.current.close().catch(() => {}); } catch {} }
    cleanup();
  }

  // External unplug detection
  useEffect(() => {
    if (!serialSupported()) return;
    const onDisc = (e) => {
      if (e.target === portRef.current) {
        setError('Perangkat dilepas.');
        forcedDisconnect();
      }
    };
    navigator.serial.addEventListener('disconnect', onDisc);
    return () => navigator.serial.removeEventListener('disconnect', onDisc);
  }, []);

  return { connState, error, connect, disconnect, send };
}

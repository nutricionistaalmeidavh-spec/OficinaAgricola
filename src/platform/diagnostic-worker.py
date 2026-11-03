#!/usr/bin/env python3
"""Ponte de diagnóstico local e opt-in, sem serviços remotos nem gravação em ECU.
J2534: somente consultas SAE J1979 sobre ISO15765 (Windows, driver do fabricante).
J1939: captura passiva CAN, nunca transmite frames para a máquina.
Entrada e saída JSON, executada por Node via stdin sem shell.
"""
import ctypes
import json
import os
import re
import socket
import struct
import sys
import time
from pathlib import Path

MAX_CAPTURE_FRAMES = 400
CAN_BACKENDS = {"socketcan", "pcan", "kvaser", "vector", "usb2can", "ixxat", "slcan", "gs_usb", "cantact"}
OBD_REQUESTS = ("03", "07", "0A", "0101", "0104", "0105", "010C", "010D", "010F", "0110", "0111", "012F", "0142")
REPLIES = {"03": 0x43, "07": 0x47, "0A": 0x4A}
for _pid in OBD_REQUESTS:
    if _pid.startswith("01"):
        REPLIES[_pid] = 0x41


def get_j2534_drivers():
    if sys.platform != "win32":
        return []
    import winreg
    result = {}
    # Compatibilidade para instaladores 32/64-bit sem aceitar DLL arbitrária do navegador.
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            root = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\PassThruSupport.04.04",
                                  0, winreg.KEY_READ | view)
        except OSError:
            continue
        with root:
            count = winreg.QueryInfoKey(root)[0]
            for i in range(count):
                try:
                    key = winreg.EnumKey(root, i)
                    with winreg.OpenKey(root, key) as item:
                        path = winreg.QueryValueEx(item, "FunctionLibrary")[0]
                    file = Path(path)
                    if not file.is_absolute() or not file.is_file():
                        continue
                    if not re.fullmatch(r"[A-Za-z0-9 _.,()\-]{1,100}", key):
                        continue
                    result[key] = {"key": key, "name": key, "installed": True}
                except (OSError, ValueError):
                    continue
    return list(result.values())


def get_driver_library(key):
    if sys.platform != "win32":
        raise ValueError("J2534 requer Windows e driver Pass-Thru instalado")
    import winreg
    for view in (winreg.KEY_WOW64_64KEY, winreg.KEY_WOW64_32KEY):
        try:
            root = winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\PassThruSupport.04.04",
                                  0, winreg.KEY_READ | view)
            with root, winreg.OpenKey(root, key) as item:
                file = Path(winreg.QueryValueEx(item, "FunctionLibrary")[0])
                if file.is_absolute() and file.is_file():
                    return str(file)
        except OSError:
            pass
    raise ValueError("Driver J2534 não instalado ou biblioteca DLL não encontrada")


def probe():
    drivers = get_j2534_drivers()
    can_ok = False
    try:
        import can  # noqa: F401 (biblioteca open source opcional)
        can_ok = True
    except ImportError:
        pass
    native_socketcan = sys.platform.startswith("linux") and hasattr(socket, "AF_CAN")
    return {"j2534": {"ready": bool(drivers), "drivers": drivers,
                       "hint": "Requer driver J2534 04.04 e DLL da mesma arquitetura do Python"},
            "j1939": {"ready": can_ok or native_socketcan,
                      "backends": sorted(CAN_BACKENDS),
                      "nativeSocketcan": native_socketcan, "pythonCan": can_ok,
                      "hint": "Conecte a interface CAN e instale apenas o driver do fabricante, se necessário"}}


def validate_options(options):
    adapter = str(options.get("adapterId", "")).upper()
    if adapter == "J2534":
        key = str(options.get("driverKey", ""))
        if key and not re.fullmatch(r"[A-Za-z0-9 _.,()\-]{1,100}", key):
            raise ValueError("Identificador J2534 inválido")
        bitrate = int(options.get("bitrate", 500000))
        if bitrate not in (250000, 500000):
            raise ValueError("Bitrate J2534 inválido")
        return adapter, {"driverKey": key, "bitrate": bitrate}
    if adapter == "J1939":
        interface = str(options.get("interface", "socketcan")).lower()
        channel = str(options.get("channel", "can0"))
        bitrate = int(options.get("bitrate", 250000))
        seconds = int(options.get("durationSeconds", 7))
        if (interface not in CAN_BACKENDS or
                not re.fullmatch(r"[A-Za-z0-9_.:/\-]{1,80}", channel) or
                bitrate not in (250000, 500000) or seconds < 2 or seconds > 15):
            raise ValueError("Configuração CAN inválida")
        return adapter, {"interface": interface, "channel": channel,
                         "bitrate": bitrate, "durationSeconds": seconds}
    raise ValueError("Adaptador desconhecido")


def sniff_socketcan(channel, seconds):
    if not sys.platform.startswith("linux") or not hasattr(socket, "AF_CAN"):
        raise ValueError("SocketCAN nativo requer Linux")
    bus = socket.socket(socket.AF_CAN, socket.SOCK_RAW, socket.CAN_RAW)
    frames = []
    try:
        bus.bind((channel,))
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and len(frames) < MAX_CAPTURE_FRAMES:
            bus.settimeout(min(0.5, max(0.02, deadline - time.monotonic())))
            try:
                data = bus.recv(16)
            except socket.timeout:
                continue
            if len(data) < 16:
                continue
            arb_id, length, raw = struct.unpack("=IB3x8s", data)
            if not arb_id & 0x80000000 or length != 8:
                continue
            arb_id &= 0x1FFFFFFF
            frames.append({"id": arb_id, "data": raw.hex(" ").upper()})
    finally:
        bus.close()
    return frames


def sniff_python_can(interface, channel, bitrate, seconds):
    try:
        import can
    except ImportError as exc:
        raise ValueError("Instale a biblioteca open source: python -m pip install python-can") from exc
    kwargs = {"interface": interface, "channel": channel, "receive_own_messages": False}
    if interface != "socketcan":
        kwargs["bitrate"] = bitrate
    frames = []
    with can.Bus(**kwargs) as bus:
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline and len(frames) < MAX_CAPTURE_FRAMES:
            msg = bus.recv(timeout=min(0.5, max(0.02, deadline - time.monotonic())))
            if msg is None or not msg.is_extended_id or len(msg.data) != 8 or msg.is_error_frame:
                continue
            frames.append({"id": int(msg.arbitration_id),
                           "data": bytes(msg.data).hex(" ").upper()})
    return frames


def capture_j1939(opts):
    if opts["interface"] == "socketcan" and sys.platform.startswith("linux"):
        frames = sniff_socketcan(opts["channel"], opts["durationSeconds"])
    else:
        frames = sniff_python_can(opts["interface"], opts["channel"], opts["bitrate"],
                                  opts["durationSeconds"])
    if not frames:
        raise ValueError("Nenhum quadro CAN J1939 recebido. Confira interface, canal, bitrate e ignição")
    return {"adapterId": "J1939", "source": "REAL",
            "protocol": "SAE J1939 CAN - leitura passiva",
            "j1939": {"frames": frames}}


# ABI SAE J2534 04.04: estrutura nativa com unsigned long Windows de 32 bits.
class PassThruMsg(ctypes.Structure):
    _fields_ = [("ProtocolID", ctypes.c_uint32), ("RxStatus", ctypes.c_uint32),
                ("TxFlags", ctypes.c_uint32), ("Timestamp", ctypes.c_uint32),
                ("DataSize", ctypes.c_uint32), ("ExtraDataIndex", ctypes.c_uint32),
                ("Data", ctypes.c_ubyte * 4128)]


DWORD = ctypes.c_uint32
ISO15765 = 6
FLOW_CONTROL_FILTER = 3
ISO15765_FRAME_PAD = 0x40


def pt_call(dll, name, *args):
    function = getattr(dll, name)
    status = function(*args)
    if status != 0:
        raise ValueError(f"Driver J2534: {name} falhou (status {status})")


def pt_message(payload, flags=0):
    message = PassThruMsg()
    message.ProtocolID = ISO15765
    message.TxFlags = flags
    message.DataSize = len(payload)
    for index, value in enumerate(payload):
        message.Data[index] = value
    return message


def capture_j2534(opts):
    drivers = get_j2534_drivers()
    if not drivers:
        raise ValueError("Nenhum driver J2534 04.04 instalado no Windows")
    key = opts["driverKey"] or (drivers[0]["key"] if len(drivers) == 1 else "")
    if not key:
        raise ValueError("Selecione o driver J2534 quando houver mais de um instalado")
    if not any(d["key"] == key for d in drivers):
        raise ValueError("Driver J2534 solicitado não está instalado")
    try:
        dll = ctypes.WinDLL(get_driver_library(key))
    except (OSError, AttributeError) as exc:
        raise ValueError("DLL J2534 não pôde ser carregada: confirme instalação e arquitetura 32/64 bits") from exc
    device, channel = DWORD(), DWORD()
    opened = False
    connected = False
    try:
        pt_call(dll, "PassThruOpen", None, ctypes.byref(device))
        opened = True
        pt_call(dll, "PassThruConnect", device, DWORD(ISO15765), DWORD(0),
                DWORD(opts["bitrate"]), ctypes.byref(channel))
        connected = True
        mask = pt_message(bytes([0x00, 0x00, 0x07, 0xFF]))
        pattern = pt_message(bytes([0x00, 0x00, 0x07, 0xE8]))
        flow = pt_message(bytes([0x00, 0x00, 0x07, 0xE0]))
        # Aceita fluxo de ECU 7E8. Outras ECUs requerem filtros por endereço.
        filter_id = DWORD()
        pt_call(dll, "PassThruStartMsgFilter", channel, DWORD(FLOW_CONTROL_FILTER),
                ctypes.byref(mask), ctypes.byref(pattern), ctypes.byref(flow),
                ctypes.byref(filter_id))
        responses = {}
        for request in OBD_REQUESTS:
            payload = bytes.fromhex(request)
            message = pt_message(bytes([0x00, 0x00, 0x07, 0xDF]) + payload,
                                 ISO15765_FRAME_PAD)
            count = DWORD(1)
            pt_call(dll, "PassThruWriteMsgs", channel, ctypes.byref(message),
                    ctypes.byref(count), DWORD(1500))
            if count.value != 1:
                continue
            deadline = time.monotonic() + 1.2
            expected = REPLIES[request]
            while time.monotonic() < deadline:
                reply = PassThruMsg()
                received = DWORD(1)
                status = dll.PassThruReadMsgs(channel, ctypes.byref(reply),
                                              ctypes.byref(received), DWORD(250))
                if status != 0 or received.value < 1 or reply.DataSize < 5:
                    continue
                raw = bytes(reply.Data[:reply.DataSize])
                if raw[:4] != bytes.fromhex("000007E8"):
                    continue
                data = raw[4:]
                # Alguns drivers expõem o PCI byte de uma resposta ISO-TP.
                if data and data[0] <= 7 and len(data) >= data[0] + 1 and data[1] == expected:
                    data = data[1:1 + data[0]]
                if not data or data[0] != expected:
                    continue
                if request.startswith("01") and (len(data) < 2 or data[1] != payload[1]):
                    continue
                responses[request] = data.hex(" ").upper()
                break
        if not responses:
            raise ValueError("J2534 conectado, mas a ECU não retornou dados OBD-II ISO15765")
        return {"adapterId": "J2534", "source": "REAL",
                "protocol": f"SAE J2534 ISO15765 {opts['bitrate']} bit/s",
                "responses": responses}
    finally:
        if connected:
            try:
                dll.PassThruDisconnect(channel)
            except Exception:
                pass
        if opened:
            try:
                dll.PassThruClose(device)
            except Exception:
                pass


def main():
    request = json.loads(sys.stdin.read(4096))
    action = request.get("action")
    if action == "probe":
        return probe()
    if action != "capture":
        raise ValueError("Operação não permitida")
    adapter, options = validate_options(request.get("options", {}))
    return capture_j2534(options) if adapter == "J2534" else capture_j1939(options)


if __name__ == "__main__":
    try:
        print(json.dumps({"ok": True, "data": main()}, ensure_ascii=False))
    except (ValueError, OSError, RuntimeError, ImportError, KeyError, TypeError) as exc:
        print(json.dumps({"ok": False, "error": str(exc)[:300]}, ensure_ascii=False))

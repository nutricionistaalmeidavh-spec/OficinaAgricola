import importlib.util
import itertools
import pathlib
import sys
import types
import unittest
from unittest.mock import patch

FILE = pathlib.Path(__file__).resolve().parents[2] / 'src' / 'platform' / 'diagnostic-worker.py'
spec = importlib.util.spec_from_file_location('diagnostic_worker', FILE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

class DiagnosticWorkerTests(unittest.TestCase):
    def test_rejects_unsupported_protocol_or_unsafe_channel(self):
        with self.assertRaisesRegex(ValueError, 'Adaptador'):
            worker.validate_options({'adapterId':'UNKNOWN'})
        with self.assertRaisesRegex(ValueError, 'Configuração'):
            worker.validate_options({'adapterId':'J1939','interface':'virtual'})
        with self.assertRaisesRegex(ValueError, 'Configuração'):
            worker.validate_options({'adapterId':'J1939','interface':'socketcan','channel':'bad; rm /'})
        with self.assertRaisesRegex(ValueError, 'Identificador'):
            worker.validate_options({'adapterId':'J2534','driverKey':'../../third-party.dll'})

    def test_j2534_message_abi_and_read_only_request_allowlist(self):
        self.assertEqual(worker.OBD_REQUESTS[0], '03')
        self.assertNotIn('04', worker.OBD_REQUESTS)
        self.assertIn('010C', worker.OBD_REQUESTS)
        message=worker.pt_message(b'\\x00\\x00\\x07\\xdf\\x01\\x0c',worker.ISO15765_FRAME_PAD)
        self.assertEqual(message.ProtocolID,worker.ISO15765)
        self.assertEqual(message.DataSize,6)
        self.assertEqual(bytes(message.Data[:6]),b'\\x00\\x00\\x07\\xdf\\x01\\x0c')

    def test_j1939_python_can_is_strictly_passive(self):
        class Frame:
            is_extended_id=True
            is_error_frame=False
            arbitration_id=0x18FECA17
            data=bytes.fromhex('00 00 BE 00 05 02 FF FF')
        class Bus:
            instances=[]
            def __init__(self, **kwargs):
                self.kwargs=kwargs
                self.send_calls=0
                self.messages=[Frame()]
                Bus.instances.append(self)
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def recv(self,timeout=0):
                return self.messages.pop(0) if self.messages else None
            def send(self,*_): self.send_calls+=1;raise AssertionError('J1939 não pode transmitir')
        with patch.dict(sys.modules,{'can':types.SimpleNamespace(Bus=Bus)}):
            with patch.object(worker.time,'monotonic',side_effect=itertools.count(0,1)):
                frames=worker.sniff_python_can('pcan','PCAN_USBBUS1',250000,3)
        self.assertEqual(len(frames),1)
        self.assertEqual(frames[0]['id'],0x18FECA17)
        self.assertEqual(Bus.instances[0].send_calls,0)
        self.assertFalse(Bus.instances[0].kwargs['receive_own_messages'])

    def test_probe_is_offline_and_describes_optional_dependencies(self):
        data=worker.probe()
        self.assertIn('j2534',data)
        self.assertIn('j1939',data)
        self.assertIn('socketcan',data['j1939']['backends'])
        self.assertIn('drivers',data['j2534'])

if __name__=='__main__':
    unittest.main()

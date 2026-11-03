import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
MODULE = ROOT / "src" / "platform" / "acbrlib-worker.py"
spec = importlib.util.spec_from_file_location("acbrlib_worker", MODULE)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)

KEY = "35261111222333000181550010000000011000000011"

class AcbrWorkerSecurityTests(unittest.TestCase):
    def test_parses_actual_acbr_style_ini_sections(self):
        result = worker.parse_sections(
            "[ENVIO]\nTpAmb=2\nCStat=103\n[NFE1]\nCStat=100\n"
            "NProt=13512345\nchDFe=" + KEY + "\n"
        )
        self.assertEqual(result["ENVIO"]["CSTAT"], "103")
        self.assertEqual(result["NFE1"]["NPROT"], "13512345")

    def test_nfe_requires_signature_and_matching_official_protocol(self):
        xml = ('<nfeProc><NFe><infNFe Id="NFe' + KEY + '"><ide>'
               '<nNF>1</nNF><serie>1</serie><tpAmb>2</tpAmb></ide>'
               '<emit><CNPJ>11222333000181</CNPJ></emit></infNFe>'
               '<Signature/></NFe><protNFe><infProt><cStat>100</cStat>'
               '<nProt>13512345</nProt></infProt></protNFe></nfeProc>')
        self.assertTrue(worker.authorized_nfe_xml(xml, "13512345"))
        self.assertFalse(worker.authorized_nfe_xml(xml, "OUTRA"))
        self.assertFalse(worker.authorized_nfe_xml(xml.replace("<Signature/>", ""), "13512345"))
        self.assertEqual(worker.nfe_identity(xml)[0], KEY)

    def test_receipt_only_is_not_nfse_authorization(self):
        self.assertIsNone(worker.nfse_details('<Envio><Sucesso>1</Sucesso><Protocolo>123</Protocolo></Envio>'))
        self.assertIsNone(worker.nfse_details('<CompNfse><Nfse><InfNfse><Numero>1</Numero>'
                                              '<CodigoVerificacao>ABC</CodigoVerificacao></InfNfse></Nfse></CompNfse>'))

    def test_wrong_environment_and_missing_binary_fail_before_ctypes(self):
        with self.assertRaises(worker.ACBrError):
            worker.execute({"operation": "transmit", "kind": "NFE", "environment": "DEV"})
        with self.assertRaises(worker.ACBrError):
            worker.execute({"operation": "transmit", "kind": "NFE", "environment": "HOMOLOGACAO",
                            "issuerCnpj": "11222333000181", "libraryPath": "/nonexistent/library.so",
                            "configPath": "/missing", "iniPath": "/missing"})

if __name__ == "__main__":
    unittest.main()

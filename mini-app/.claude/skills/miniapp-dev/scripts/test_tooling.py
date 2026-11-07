"""对脚手架、Python 安装约束与可导入 zip 的行为检查；只依赖标准库。"""

import json
import pathlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

sys.dont_write_bytecode = True
sys.path.insert(0, str(pathlib.Path(__file__).parent))
import check_miniapp

SCRIPTS = pathlib.Path(__file__).parent


class ToolingTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="ant_miniapp_test_")
        self.root = pathlib.Path(self.temp.name) / "app"
        subprocess.run([sys.executable, str(SCRIPTS / "new_miniapp.py"), "--app-id", "com.example.python",
                        "--name", "Python 示例", "--python", "--out", str(self.root)], check=True, capture_output=True)

    def tearDown(self):
        self.temp.cleanup()

    def manifest(self, change):
        path = self.root / "manifest.json"
        data = json.loads(path.read_text())
        change(data)
        path.write_text(json.dumps(data))

    def report(self):
        report = check_miniapp.Report()
        manifest = check_miniapp.check_manifest(self.root, report)
        files = check_miniapp.collect(self.root, report)
        check_miniapp.scan(self.root, files, manifest, report)
        return report

    def test_python_scaffold_is_importable_and_prechecks_cleanly(self):
        import runpy
        entry = runpy.run_path(str(self.root / "app.py"))
        self.assertEqual(entry["hello"]({"name":"读者"}, 2)["sum"], 5)
        self.assertEqual(self.report().errors, [])
        self.assertEqual(self.report().warns, [])

    def test_python_block_missing_permission_or_entry_is_rejected(self):
        self.manifest(lambda m: m["permissions"].remove("python"))
        self.assertIn("PYTHON_PERMISSION_MISSING", [code for code, _ in self.report().errors])
        self.manifest(lambda m: m["permissions"].append("python"))
        (self.root / "app.py").unlink()
        self.assertIn("PYTHON_ENTRY_MISSING", [code for code, _ in self.report().errors])

    def test_runtime_conflict_and_traversal_are_rejected(self):
        self.manifest(lambda m: m.update(node={"entry":"app.js"}))
        self.assertIn("SERVICE_RUNTIME_CONFLICT", [code for code, _ in self.report().errors])
        self.manifest(lambda m: m["python"].update(entry="../outside.py"))
        self.assertIn("INVALID_PYTHON_ENTRY", [code for code, _ in self.report().errors])

    def test_new_js_apis_have_permission_gates(self):
        self.manifest(lambda m: m.update(permissions=[]))
        (self.root / "app.js").write_text("ant.python.call('hello'); ant.file.read('a'); ant.requestStream({}); ant.resolveService('miniapp://com.foo.svc');")
        errors = "\n".join(message for code, message in self.report().errors if code == "MISSING_PERMISSION")
        for perm in ["python", "filesystem", "network", "miniapp"]:
            self.assertIn('"' + perm + '"', errors)

    def test_python_service_uses_expanded_package_limits(self):
        files = [("dummy", type("Sized", (), {"stat": lambda _: type("Stat", (), {"st_size":1})()})())] * 2001
        report = check_miniapp.Report()
        check_miniapp.check_limits(files, report, node_app=True)
        self.assertEqual(report.errors, [])
        check_miniapp.check_limits(files, report, node_app=False)
        self.assertIn("TOO_MANY_ENTRIES", [code for code, _ in report.errors])

    def test_zip_root_and_python_dependencies_without_development_files(self):
        (self.root / "dependency.py").write_text("answer = 42")
        (self.root / "__pycache__").mkdir()
        (self.root / "__pycache__" / "app.pyc").write_bytes(b"compiled")
        (self.root / "stray.pyc").write_bytes(b"compiled")
        (self.root / ".env").write_text("development only")
        archive = pathlib.Path(self.temp.name) / "app.zip"
        subprocess.run([sys.executable, str(SCRIPTS / "pack_miniapp.py"), str(self.root), "-o", str(archive)], check=True, capture_output=True)
        with zipfile.ZipFile(archive) as package:
            names = package.namelist()
            self.assertIn("manifest.json", names)
            self.assertIn("app.py", names)
            self.assertIn("dependency.py", names)
            self.assertFalse(any(name.endswith(".pyc") or name.startswith(".") for name in names))


if __name__ == "__main__":
    unittest.main()

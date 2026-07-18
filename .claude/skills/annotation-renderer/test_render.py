import json, os, tempfile, unittest
from PIL import Image
import render  # render.py in the same directory


class RenderRuleTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.shot = os.path.join(self.dir, "shot.png")
        Image.new("RGB", (400, 300), "white").save(self.shot)

    def _spec(self):
        return {
            "viewport": {"width": 400, "height": 300, "scroll_height": 300},
            "findings": [
                {"rank": 1, "severity": "critical", "agent": "a", "issue": "crit here",
                 "location": {"type": "bbox", "x": 10, "y": 10, "width": 80, "height": 20}},
                {"rank": 2, "severity": "major", "agent": "b", "issue": "major no loc",
                 "location": None},
                {"rank": 3, "severity": "minor", "agent": "c", "issue": "minor here",
                 "location": {"type": "bbox", "x": 10, "y": 100, "width": 80, "height": 20}},
            ],
        }

    def test_only_critical_and_major_are_pinned(self):
        m = render.render(self._spec(), self.shot)
        pinned = {p["rank"] for p in m["pins"]}
        self.assertEqual(pinned, {1})                      # crit with a box
        self.assertEqual({u["rank"] for u in m["unplaced"]}, {2})   # major, no box
        self.assertEqual({s["rank"] for s in m["skipped"]}, {3})    # minor, by rule
        self.assertTrue(os.path.exists(m["annotated_screenshot_path"]))

    def test_normalized_coords_scale_to_pixels(self):
        spec = self._spec()
        spec["normalized"] = True
        spec["findings"][0]["location"] = {"type": "bbox", "x": 0.5, "y": 0.5, "width": 0.25, "height": 0.1}
        m = render.render(spec, self.shot)
        pin = next(p for p in m["pins"] if p["rank"] == 1)
        self.assertGreater(pin["x"], 150)   # 0.5*400 = 200-ish region, not a raw 0.5px
        self.assertGreater(pin["y"], 130)


if __name__ == "__main__":
    unittest.main()

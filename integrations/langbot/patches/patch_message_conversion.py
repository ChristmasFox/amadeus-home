from pathlib import Path
import sys


source_path = Path(
    sys.argv[1]
    if len(sys.argv) > 1
    else "/app/src/langbot/pkg/provider/modelmgr/requesters/litellmchat.py"
)
source = source_path.read_text()

old_block = """                    if isinstance(part, dict) and part.get('type') == 'image_base64':
                        part['image_url'] = {'url': part['image_base64']}
                        part['type'] = 'image_url'
                        del part['image_base64']
"""
new_block = """                    if isinstance(part, dict) and part.get('type') == 'image_base64':
                        image_base64 = part.get('image_base64')
                        if not isinstance(image_base64, str) or not image_base64:
                            continue
                        part = dict(part)
                        part['image_url'] = {'url': image_base64}
                        part['type'] = 'image_url'
                        part.pop('image_base64', None)
"""

if old_block not in source:
    if "image_base64 = part.get('image_base64')" not in source:
        raise SystemExit("image conversion block not found")
else:
    source = source.replace(old_block, new_block, 1)

source_path.write_text(source)

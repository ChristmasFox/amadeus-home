import base64, hashlib, os, socket, struct, sys
from urllib.parse import urlparse

url = sys.argv[1]
token = sys.argv[2]
workspace = sys.argv[3]
parsed = urlparse(url)
key = base64.b64encode(os.urandom(16)).decode()
request = (
    f"GET {parsed.path}?{parsed.query} HTTP/1.1\r\n"
    f"Host: {parsed.netloc}\r\n"
    "Upgrade: websocket\r\n"
    "Connection: Upgrade\r\n"
    f"Sec-WebSocket-Key: {key}\r\n"
    "Sec-WebSocket-Version: 13\r\n\r\n"
).encode()
sock = socket.create_connection((parsed.hostname, parsed.port or 80), timeout=10)
sock.sendall(request)
response = b""
while b"\r\n\r\n" not in response:
    response += sock.recv(4096)
print(response.decode("latin1", "replace")[:2000])
if b" 101 " not in response.split(b"\r\n", 1)[0]:
    sock.close(); raise SystemExit(0)

def send(payload):
    data = payload.encode()
    mask = os.urandom(4)
    masked = bytes(data[i] ^ mask[i % 4] for i in range(len(data)))
    header = bytes([0x81])
    length = len(masked)
    if length < 126:
        header += bytes([0x80 | length])
    elif length < 65536:
        header += bytes([0x80 | 126]) + struct.pack('!H', length)
    else:
        header += bytes([0x80 | 127]) + struct.pack('!Q', length)
    sock.sendall(header + mask + masked)

def recv_frame():
    first = sock.recv(2)
    if not first: return None
    b1,b2=first
    length=b2 & 0x7f
    if length==126: length=struct.unpack('!H',sock.recv(2))[0]
    elif length==127: length=struct.unpack('!Q',sock.recv(8))[0]
    if b2 & 0x80:
        mask=sock.recv(4)
    else: mask=None
    payload=b''
    while len(payload)<length: payload += sock.recv(length-len(payload))
    if mask: payload=bytes(payload[i]^mask[i%4] for i in range(len(payload)))
    return (b1 & 0xf, payload)

send('{"type":"authenticate","token":"'+token.replace('\\','\\\\').replace('"','\\"')+'","workspace_uuid":"'+workspace+'"}')
frame=recv_frame()
if frame:
    import json
    try:
        obj=json.loads(frame[1].decode())
        if isinstance(obj,dict):
            print({k:obj.get(k) for k in ('type','message','session_type','pipeline_uuid')})
        else: print(type(obj).__name__)
    except Exception: print(frame[1][:300].decode('utf-8','replace'))
sock.close()

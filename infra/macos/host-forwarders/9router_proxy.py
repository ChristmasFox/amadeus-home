#!/usr/bin/env python3
import os
import selectors
import shutil
import socket
import subprocess
import threading
from contextlib import closing

LISTEN_HOST = "0.0.0.0"
LISTEN_PORT = 20128
TARGET_PORT = 20128
ORB_MACHINE = os.environ.get("ORBSTACK_MACHINE", "ubuntu")
ORB_BIN = os.environ.get("ORB_BIN") or shutil.which("orb") or "orb"
TARGET_HOST = os.environ.get("ORBSTACK_TARGET_HOST")


def resolve_target_host():
    if TARGET_HOST:
        return TARGET_HOST
    cmd = [
        ORB_BIN,
        "-m",
        ORB_MACHINE,
        "-u",
        "root",
        "sh",
        "-lc",
        "hostname -I",
    ]
    output = subprocess.check_output(cmd, text=True, timeout=10).strip()
    for token in output.split():
        if token.count(".") == 3 and not token.startswith("127."):
            return token
    raise RuntimeError(f"no suitable OrbStack IPv4 found in: {output!r}")


def pipe_bidirectional(left, right):
    sel = selectors.DefaultSelector()
    sel.register(left, selectors.EVENT_READ, right)
    sel.register(right, selectors.EVENT_READ, left)
    sockets = {left, right}
    try:
        while sockets:
            for key, _ in sel.select():
                src = key.fileobj
                dst = key.data
                try:
                    data = src.recv(65536)
                except OSError:
                    data = b""
                if not data:
                    try:
                        sel.unregister(src)
                    except Exception:
                        pass
                    sockets.discard(src)
                    try:
                        dst.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass
                    continue
                dst.sendall(data)
    finally:
        for sock in (left, right):
            try:
                sel.unregister(sock)
            except Exception:
                pass
            try:
                sock.close()
            except OSError:
                pass
        sel.close()


def handle_client(client_sock, client_addr):
    try:
        target_host = resolve_target_host()
        upstream = socket.create_connection((target_host, TARGET_PORT), timeout=10)
    except Exception:
        client_sock.close()
        return
    pipe_bidirectional(client_sock, upstream)


def main():
    with closing(socket.socket(socket.AF_INET6, socket.SOCK_STREAM)) as test_sock:
        pass
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as server:
        server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        server.bind((LISTEN_HOST, LISTEN_PORT))
        server.listen(128)
        while True:
            client_sock, client_addr = server.accept()
            thread = threading.Thread(
                target=handle_client, args=(client_sock, client_addr), daemon=True
            )
            thread.start()


if __name__ == "__main__":
    main()

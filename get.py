import socket
import sys
import json
import os, os.path
import salt.client

if os.path.exists('/var/run/cryptr-server/conn.sock'):
    client = socket.socket( socket.AF_UNIX, socket.SOCK_STREAM )
    client.connect('/var/run/cryptr-server/conn.sock')
    try:
        caller = salt.client.Caller()
        pws = caller.function('pillar.items')
        client.send(json.dumps(pws))
    except:
        temp = 'placeholder'
    client.close()

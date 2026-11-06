"""A tiny SSH server for tests (asyncssh). User 'tester': password 'secret',
or any public key listed in --authorized (re-read on every attempt). The
shell is fake: echoes typed characters, runs `echo X`, `seq N`, `whoami`, `color`
(red text), `exit`; ^C cancels the line, ↑ recalls the last command."""
import argparse
import asyncio
from pathlib import Path

import asyncssh

AUTHORIZED = None


class Server(asyncssh.SSHServer):
    def begin_auth(self, username):
        return True

    def password_auth_supported(self):
        return True

    def validate_password(self, username, password):
        return username == "tester" and password == "secret"

    def public_key_auth_supported(self):
        return True

    def validate_public_key(self, username, key):
        if username != "tester" or not AUTHORIZED.exists():
            return False
        mine = key.export_public_key("openssh").decode().split()[1]
        return any(line.split()[1:2] == [mine] for line in AUTHORIZED.read_text().splitlines() if line.strip())


async def shell(process):
    out = process.stdout
    user = process.get_extra_info("username")
    out.write(f"fake shell for {user} ({process.get_terminal_type()} {process.get_terminal_size()[0]}x{process.get_terminal_size()[1]})\r\n$ ")
    line, last = "", ""
    while True:
        ch = await process.stdin.read(1)
        if not ch:
            break
        if ch == "\x1b":
            # Escape sequences: ↑ recalls the last command; others are echoed as
            # <esc:...> (F-keys, Shift+Tab, PgUp…); ESC + a plain key is <alt:x>.
            nxt = await process.stdin.read(1)
            if nxt not in ("[", "O"):
                out.write(f"<alt:{nxt}>")
                continue
            seq = nxt
            while True:
                c = await process.stdin.read(1)
                seq += c
                if c.isalpha() or c == "~":
                    break
            if seq == "[A" and last:
                out.write("\b \b" * len(line) + last)
                line = last
            elif seq != "[A":
                out.write(f"<esc:{seq}>")
            continue
        if ch == "\r":
            out.write("\r\n")
            cmd = line.strip()
            last = cmd or last
            line = ""
            if cmd == "exit":
                process.exit(0)
                return
            if cmd.startswith("echo "):
                out.write(cmd[5:] + "\r\n")
            elif cmd.startswith("seq "):
                out.write("".join(f"{i}\r\n" for i in range(1, int(cmd[4:]) + 1)))
            elif cmd == "whoami":
                out.write(user + "\r\n")
            elif cmd == "color":
                out.write("\x1b[1;31mred\x1b[0m plain\r\n")
            elif cmd:
                out.write(f"{cmd}: command not found\r\n")
            out.write("$ ")
        elif ch == "\x7f":
            if line:
                line = line[:-1]
                out.write("\b \b")
        elif ch == "\x03":
            out.write("^C\r\n$ ")
            line = ""
        elif ch == "\t":
            out.write("<tab>")
        elif ch >= " ":
            line += ch
            out.write(ch)


async def main(port, authorized, hostkey):
    global AUTHORIZED
    AUTHORIZED = Path(authorized)
    key = Path(hostkey)
    if not key.exists():
        asyncssh.generate_private_key("ssh-ed25519").write_private_key(str(key))
    await asyncssh.create_server(Server, "127.0.0.1", port, server_host_keys=[str(key)], process_factory=shell,
                                 line_editor=False)
    await asyncio.Event().wait()


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, required=True)
    ap.add_argument("--authorized", required=True)
    ap.add_argument("--hostkey", required=True)
    a = ap.parse_args()
    asyncio.run(main(a.port, a.authorized, a.hostkey))

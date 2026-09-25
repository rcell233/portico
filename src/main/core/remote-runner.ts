export const remoteRunner = String.raw`import base64, fcntl, json, os, signal, socket, subprocess, sys, time
spec = json.loads(base64.b64decode(sys.argv[1]))
root = os.path.join(os.path.expanduser("~"), ".local", "share", "portico", "services", spec["id"])
os.makedirs(root, mode=0o700, exist_ok=True)
state_path = os.path.join(root, "state.json")
def state():
    try:
        with open(state_path) as f: return json.load(f)
    except (OSError, ValueError): return {}
def birth(pid):
    try:
        with open("/proc/%s/stat" % pid) as f: return f.read().rsplit(")", 1)[1].split()[19]
    except OSError: return None
def owned(s):
    pid = s.get("pid")
    if not pid or birth(pid) != s.get("birth"): return False
    try:
        with open("/proc/%s/environ" % pid, "rb") as f:
            return ("PORTICO_SERVICE_ID=" + spec["id"]).encode() in f.read().split(b"\0")
    except OSError: return False
def listening():
    try:
        with socket.create_connection((spec["hostname"], spec["port"]), timeout=2): return True
    except OSError: return False
if spec["action"] == "logs":
    try:
        with open(os.path.join(root, "output.log"), "rb") as f:
            f.seek(0, 2); size = f.tell(); f.seek(max(0, size - 65536)); print(f.read().decode("utf8", "replace"))
    except OSError: print("尚无托管日志。已有服务的日志由原启动方式管理。")
    sys.exit(0)
with open(os.path.join(root, "lock"), "a+") as lock:
    deadline = time.time() + 8
    while True:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB); break
        except BlockingIOError:
            if time.time() > deadline: raise RuntimeError("服务操作正在进行，请稍后重试")
            time.sleep(.1)
    s = state()
    if spec["action"] == "stop":
        if not owned(s):
            print(json.dumps({"status": "unmanaged", "message": "没有可安全停止的 Portico 托管进程；未停止任何进程。"})); sys.exit(0)
        pid = s["pid"]
        os.killpg(pid, signal.SIGTERM)
        for _ in range(30):
            if not owned(s): break
            time.sleep(.1)
        if owned(s):
            print(json.dumps({"status": "running", "message": "已发送 SIGTERM，进程尚未退出；请查看日志。"})); sys.exit(0)
        os.unlink(state_path)
        print(json.dumps({"status": "stopped"})); sys.exit(0)
    if owned(s):
        print(json.dumps({"status": "managed", "pid": s["pid"]})); sys.exit(0)
    if listening():
        print(json.dumps({"status": "existing"})); sys.exit(0)
    env = dict(os.environ)
    env.update(spec["environment"])
    env["PORTICO_SERVICE_ID"] = spec["id"]
    cwd = os.path.expanduser(spec["workingDirectory"] or "~")
    with open(os.path.join(root, "output.log"), "ab", buffering=0) as log:
        os.chmod(os.path.join(root, "output.log"), 0o600)
        process = subprocess.Popen(["/bin/bash", "-lc", spec["startCommand"]], cwd=cwd, env=env,
            stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True, close_fds=True)
    s = {"pid": process.pid, "birth": birth(process.pid)}
    with open(state_path + ".tmp", "w") as f: json.dump(s, f)
    os.chmod(state_path + ".tmp", 0o600)
    os.replace(state_path + ".tmp", state_path)
    print(json.dumps({"status": "started", "pid": process.pid}))
`

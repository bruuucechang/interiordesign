"""桌面版進入點：埠位必須是穩定的。

埠位是網址來源的一部分，而來源決定 localStorage 存在哪裡——語言、「已經看過教學」
那個旗標、面板摺疊狀態、以及還沒寫進資料庫的離線鏡像，全部掛在上面。

舊版是 `(8791, 0)`：慣用埠，不然讓作業系統隨便給一個。在一台 8791 永遠綁不上的
機器上（Windows 的 Hyper-V 動態保留範圍 8712–8811），「隨便給一個」等於**每次
開啟都是不同的埠**，於是每次都是空的 localStorage、每次都是第一次執行——使用者
回報的「instruction 有時候會在奇怪時機跳出來」就是這個。

所以這裡驗的不是「有沒有拿到埠」，是**同一台機器兩次啟動會不會拿到同一個埠**。

埠位清單用參數傳進去，不用真的 8791：這台開發機上 8791 常常就開著 uvicorn，
而一條會因為「旁邊剛好有東西在跑」而紅的測試，量的是機器不是程式。
"""
from __future__ import annotations

import socket
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import desktop  # noqa: E402


def _grab(n: int) -> list[socket.socket]:
    """n 個確定綁得上、而且測試期間不會被別人搶走的埠。"""
    out = []
    for _ in range(n):
        s = socket.socket()
        s.bind(("127.0.0.1", 0))
        out.append(s)
    return out


def test_清單上第一個綁得上的就用它():
    held = _grab(2)
    try:
        taken = tuple(s.getsockname()[1] for s in held)
        free = _grab(1)
        spare = free[0].getsockname()[1]
        free[0].close()
        assert desktop.free_port(taken[:1] + (spare,)) == spare
    finally:
        for s in held:
            s.close()


def test_兩次啟動拿到同一個埠_而不是隨機():
    held = _grab(1)
    try:
        taken = held[0].getsockname()[1]
        free = _grab(2)
        a, b = (s.getsockname()[1] for s in free)
        for s in free:
            s.close()
        ports = (taken, a, b)
        first = desktop.free_port(ports)
        second = desktop.free_port(ports)
        assert first == a, "第一個綁不上就要退到清單的下一個"
        assert first == second, "兩次啟動要拿到同一個埠，否則 localStorage 每次都重來"
    finally:
        for s in held:
            s.close()


def test_每個備援埠都在_hyper_v_的動態保留範圍之外():
    # 8712–8811 是這個專案在 Windows 上實際遇到的保留區間。備援埠落在裡面的話，
    # 它會跟 8791 一起失敗，等於沒有備援。
    assert desktop.PORTS[0] == 8791
    assert len(desktop.PORTS) >= 2, "只有一個埠等於沒有備援"
    for port in desktop.PORTS[1:]:
        assert not (8712 <= port <= 8811), f"{port} 在 Hyper-V 的保留範圍內"


def test_全部被佔住時仍然開得起來():
    held = _grab(3)
    try:
        taken = tuple(s.getsockname()[1] for s in held)
        got = desktop.free_port(taken)
        assert got > 0
        assert got not in taken
    finally:
        for s in held:
            s.close()


def test_同一台機器再開一次_會接到已經在跑的那一個(monkeypatch):
    """雙擊兩次圖示不該起第二個伺服器——第二個埠＝第二個來源＝空的 localStorage。"""
    calls = []

    class FakeResp:
        def __init__(self, payload): self.payload = payload
        def read(self): return self.payload
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_open(url, timeout=0):
        calls.append(url)
        if url.endswith(f"{desktop.PORTS[1]}/api/health"):
            return FakeResp(b'{"ok": true, "app": "InteriorDesigner"}')
        raise OSError("nothing there")

    monkeypatch.setattr(desktop.urllib.request, "urlopen", fake_open)
    assert desktop.running_instance() == desktop.PORTS[1]


def test_別人的伺服器佔著那個埠_不會被誤認成自己(monkeypatch):
    class FakeResp:
        def __init__(self, payload): self.payload = payload
        def read(self): return self.payload
        def __enter__(self): return self
        def __exit__(self, *a): return False

    def fake_open(url, timeout=0):
        # 一個回 {"ok": true} 的無關服務——舊版的健康檢查長得一模一樣
        return FakeResp(b'{"ok": true}')

    monkeypatch.setattr(desktop.urllib.request, "urlopen", fake_open)
    assert desktop.running_instance() is None


def test_都沒有人在跑的時候回_None(monkeypatch):
    def fake_open(url, timeout=0): raise OSError("connection refused")
    monkeypatch.setattr(desktop.urllib.request, "urlopen", fake_open)
    assert desktop.running_instance() is None

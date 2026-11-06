"""Store.delete_space removes a Space and everything that hangs off it."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent / "server"))
from store import Store, new_id  # noqa: E402

POSE = {"p": [0, 0, 0], "q": [0, 0, 0, 1], "s": [1, 1, 1]}


def test_delete_space_removes_everything_in_it(tmp_path):
    st = Store(str(tmp_path / "t.db"))
    me = st.login("me")
    keep, gone = new_id(), new_id()
    st.create_space(me["id"], keep, "keep")
    st.create_space(me["id"], gone, "gone", anchor={"id": new_id(), "pose": POSE, "handle": "h1"}, device_id="dev")
    lid = st.space_layer(gone)
    st.put_object(me["id"], new_id(), gone, lid, POSE, {"mesh": {"primitive": "box"}})
    st.put_object(me["id"], new_id(), keep, st.space_layer(keep), POSE, {"mesh": {"primitive": "box"}})
    st.create_invite(me["id"], gone)
    st.delete_space(gone)
    q = lambda sql, *a: st.db.execute(sql, a).fetchone()[0]  # noqa: E731
    assert q("SELECT COUNT(*) FROM spaces WHERE id = ?", gone) == 0
    for table in ("anchors", "objects", "space_members", "space_invites", "markers", "surfaces"):
        assert q(f"SELECT COUNT(*) FROM {table} WHERE space_id = ?", gone) == 0, table
    assert q("SELECT COUNT(*) FROM anchor_bindings") == 0
    assert q("SELECT COUNT(*) FROM layers WHERE id = ?", lid) == 0
    assert q("SELECT COUNT(*) FROM objects WHERE space_id = ?", keep) == 1     # the other Space is untouched
    assert [s["id"] for s in st.spaces_for(me["id"], "dev")] == [keep]

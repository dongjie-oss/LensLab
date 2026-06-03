"""
Exposure Lab Backend API
FastAPI 后端服务 - 同时托管前端静态文件
"""

import os
import uuid
import json
import shutil
from datetime import datetime
from pathlib import Path

from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from analyzer import analyze_image, result_to_dict, GRID_MODES

app = FastAPI(title="Exposure Lab API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = Path(__file__).parent
UPLOAD_DIR = BASE_DIR / "uploads"
RESULT_DIR = BASE_DIR / "results"
UPLOAD_DIR.mkdir(exist_ok=True)
RESULT_DIR.mkdir(exist_ok=True)

# 历史记录文件
HISTORY_FILE = BASE_DIR / "history.json"


# ========== 文件管理 ==========

def load_history() -> list:
    if HISTORY_FILE.exists():
        try:
            with open(HISTORY_FILE) as f:
                return json.load(f)
        except:
            return []
    return []


def save_history(history: list):
    with open(HISTORY_FILE, "w") as f:
        json.dump(history, f, ensure_ascii=False, indent=2)


def cleanup_history(max_items: int = 50):
    history = load_history()
    if len(history) > max_items:
        for item in history[: len(history) - max_items]:
            src = BASE_DIR / item.get("original", "")
            res = BASE_DIR / item.get("result", "")
            if src.exists():
                src.unlink()
            if res.exists():
                res.unlink()
        history = history[-max_items:]
        save_history(history)


# ========== API 路由 ==========

@app.get("/api/grid-modes")
def get_grid_modes():
    return {
        "modes": [
            {"key": k, "name": v["name"], "rows": v["rows"], "cols": v["cols"]}
            for k, v in GRID_MODES.items()
        ]
    }


@app.post("/api/analyze")
async def analyze(
    file: UploadFile = File(...),
    mode: str = Form("9"),
    ev_method: str = Form("standard"),
):
    if not file.filename:
        raise HTTPException(400, "No file provided")

    ext = file.filename.rsplit(".", 1)[-1].lower()
    if ext not in ("jpg", "jpeg", "png"):
        raise HTTPException(400, "Only JPG and PNG files are supported")

    file_id = uuid.uuid4().hex[:12]
    original_name = f"{file_id}_original.{ext}"
    original_path = UPLOAD_DIR / original_name

    with open(original_path, "wb") as f:
        content = await file.read()
        f.write(content)

    try:
        result = analyze_image(str(original_path), mode=mode, ev_method=ev_method)
    except Exception as e:
        original_path.unlink(missing_ok=True)
        raise HTTPException(500, f"Analysis failed: {str(e)}")

    analysis_data = result_to_dict(result)
    analysis_data["file_id"] = file_id
    analysis_data["original_name"] = original_name
    analysis_data["timestamp"] = datetime.now().isoformat()

    analysis_path = RESULT_DIR / f"{file_id}.json"
    with open(analysis_path, "w") as f:
        json.dump(analysis_data, f, ensure_ascii=False, indent=2)

    history = load_history()
    history.append({
        "file_id": file_id,
        "original": f"uploads/{original_name}",
        "result": f"results/{file_id}.json",
        "filename": file.filename,
        "timestamp": analysis_data["timestamp"],
    })
    save_history(history)
    cleanup_history()

    return analysis_data


@app.get("/api/history")
def get_history():
    return {"items": load_history()}


@app.delete("/api/history/{file_id}")
def delete_history(file_id: str):
    history = load_history()
    history = [h for h in history if h["file_id"] != file_id]
    save_history(history)
    for p in UPLOAD_DIR.glob(f"{file_id}_*"):
        p.unlink(missing_ok=True)
    for p in RESULT_DIR.glob(f"{file_id}_*"):
        p.unlink(missing_ok=True)
    return {"status": "deleted"}


@app.get("/api/result/{file_id}")
def get_result(file_id: str):
    path = RESULT_DIR / f"{file_id}.json"
    if not path.exists():
        raise HTTPException(404, "Result not found")
    return json.loads(path.read_text())


# 静态文件
app.mount("/uploads", StaticFiles(directory=str(UPLOAD_DIR)), name="uploads")
app.mount("/results", StaticFiles(directory=str(RESULT_DIR)), name="results")


# ========== 前端静态文件服务 ==========
# 将 frontend/index.html 作为根路径
FRONTEND_FILE = BASE_DIR.parent / "frontend" / "index.html"
if not FRONTEND_FILE.exists():
    FRONTEND_FILE = BASE_DIR / "frontend" / "index.html"

@app.get("/")
def serve_frontend():
    if FRONTEND_FILE.exists():
        return FileResponse(str(FRONTEND_FILE))
    raise HTTPException(404, "Frontend not found")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8765)

# main.py
# Núcleo de la aplicación de backend para el análisis fitopatológico.
# Versión 1.4.0: Añadidas métricas avanzadas (tamaño de lesión) y guardado de archivos.

# --- Importaciones de Librerías ---
from fastapi import FastAPI, File, UploadFile, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from typing import Dict
import numpy as np
import cv2  # OpenCV para el procesamiento de imágenes
import uuid  # --- NUEVO --- Para generar nombres de archivo únicos
from pathlib import Path  # --- NUEVO --- Para manejar rutas de archivo de forma robusta

# --- Inicialización de la Aplicación FastAPI ---
app = FastAPI(
    title="API de Diagnóstico Fitopatológico",
    description="Procesa imágenes de hojas para análisis cuantitativo y morfológico.",
    version="1.4.0"
)

# --- Configuración de CORS ---
origins = [
    "*",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- Funciones de Lógica de Negocio (Análisis de Imagen) ---

def analyze_leaf_image(image_bytes: bytes) -> Dict:
    """
    Función principal para analizar una imagen de hoja.
    Recibe los bytes de una imagen, la procesa y devuelve las métricas.
    """
    try:
        nparr = np.frombuffer(image_bytes, np.uint8)
        img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img_bgr is None:
            return {"procesamiento_exitoso": False, "error": "No se pudo decodificar el archivo de imagen."}

        MAX_DIM = 500
        h, w, _ = img_bgr.shape
        scale_ratio = MAX_DIM / max(h, w)
        if scale_ratio < 1:
            img_bgr = cv2.resize(img_bgr, (int(w * scale_ratio), int(h * scale_ratio)), interpolation=cv2.INTER_AREA)

        img_hls = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2HLS)
        
        background_mask_bool = ((img_hls[:,:,2] < 51) | (img_hls[:,:,1] < 25) | (img_hls[:,:,1] > 242))
        background_mask_uint8 = background_mask_bool.astype(np.uint8) * 255
        foreground_mask = cv2.bitwise_not(background_mask_uint8)

        damaged_mask = cv2.inRange(img_hls, (10, 51, 25), (36, 255, 255))
        healthy_mask = cv2.inRange(img_hls, (39, 51, 25), (89, 255, 255))

        damaged_pixels = cv2.countNonZero(cv2.bitwise_and(damaged_mask, foreground_mask))
        healthy_pixels = cv2.countNonZero(cv2.bitwise_and(healthy_mask, foreground_mask))
        
        total_leaf_pixels = healthy_pixels + damaged_pixels
        
        if total_leaf_pixels == 0:
            return {"procesamiento_exitoso": False, "error": "No se detectó tejido foliar."}

        area_damage = (damaged_pixels / total_leaf_pixels) * 100

        final_damaged_mask = cv2.bitwise_and(damaged_mask, foreground_mask)
        
        # --- MODIFICADO --- Se capturan más estadísticas para el nuevo cálculo
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(final_damaged_mask, 4, cv2.CV_32S)
        lesion_count = num_labels - 1  # Restamos 1 para excluir el fondo

        # --- NUEVO --- Cálculo del tamaño promedio de las lesiones
        avg_lesion_size = 0
        if lesion_count > 0:
            # Obtenemos el área de cada lesión (componente) excluyendo el fondo (índice 0)
            lesion_areas = stats[1:, cv2.CC_STAT_AREA]
            avg_lesion_size = np.mean(lesion_areas)

        return {
            "area_afectada_pct": round(area_damage, 2),
            "conteo_lesiones": lesion_count,
            "tamanio_promedio_lesion_px": round(avg_lesion_size, 2), # Nueva métrica añadida
            "procesamiento_exitoso": True
        }

    except Exception as e:
        print(f"Error durante el análisis de imagen: {e}")
        return {"procesamiento_exitoso": False, "error": str(e)}


# --- Endpoints de la API ---

@app.get("/", tags=["General"])
def read_root():
    """Endpoint raíz para verificar que la API está funcionando."""
    return {"status": "OK", "message": "API de Fitopatología en funcionamiento."}


@app.post("/analizar-muestra/", tags=["Análisis"])
async def analizar_muestra(file: UploadFile = File(...)):
    """
    Recibe una única imagen de una hoja, la analiza y devuelve los resultados cuantitativos.
    """
    if not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="El archivo proporcionado no es una imagen.")
    
    image_bytes = await file.read()

    # --- NUEVO: CÓDIGO PARA GUARDAR LA IMAGEN ---
    # Crea una carpeta 'uploads' en el directorio del proyecto si no existe
    upload_dir = Path("uploads")
    upload_dir.mkdir(exist_ok=True)
    
    # Genera un nombre de archivo único para evitar sobreescribir y lo guarda
    file_extension = Path(file.filename).suffix
    unique_filename = f"{uuid.uuid4()}{file_extension}"
    with open(upload_dir / unique_filename, "wb") as f:
        f.write(image_bytes)
    # --- FIN DEL CÓDIGO PARA GUARDAR ---
    
    results = analyze_leaf_image(image_bytes)
    
    if not results["procesamiento_exitoso"]:
        raise HTTPException(status_code=500, detail=f"Ocurrió un error al procesar la imagen: {results.get('error', 'Error desconocido')}")

    # --- MODIFICADO --- Se añade el nombre del archivo guardado a la respuesta
    return {
        "nombre_archivo_original": file.filename,
        "nombre_archivo_guardado": unique_filename,
        "resultados": results
    }

# --- Para ejecutar el servidor localmente, usar el comando: ---
# uvicorn main:app --reload

# --- Para ejecutar el servidor localmente, usar el comando: ---
# uvicorn main:app --reload


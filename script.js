// script.js (Frontend)
// Lógica de la interfaz de usuario para interactuar con el backend de análisis.
// Versión 1.3.0: Añadida la funcionalidad de registro automático de datos en una carpeta local.

// --- Constantes y Elementos del DOM ---
const API_URL = "http://127.0.0.1:8000/analizar-muestra/";

const fileLoader = document.getElementById('fileLoader');
const analyzeButton = document.getElementById('analyzeButton');
const previewsContainer = document.getElementById('previewsContainer');
const previewsContainerWrapper = document.getElementById('previewsContainerWrapper');
const previewsHeader = document.getElementById('previewsHeader');
const initialMessage = document.getElementById('initial-message');
const resultsContent = document.getElementById('results-content');
const downloadDataCSVButton = document.getElementById('downloadDataCSV');
const selectFolderButton = document.getElementById('select-folder-button');
const folderStatus = document.getElementById('folder-status');

const progressContainer = document.getElementById('progress-container');
const progressBar = document.getElementById('progress-bar');
const progressLabel = document.getElementById('progress-label');
const progressPercentage = document.getElementById('progress-percentage');

let imageFiles = [];
let lastAnalysisResults = [];
let damageBarChartInstance, scatterPlotInstance, gradeHistogramInstance;
let directoryHandle = null; // Handle para la carpeta de destino

// --- Lógica de Pestañas ---
const tabs = document.querySelectorAll('.tab-button');
tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(tc => tc.classList.remove('active'));
        document.getElementById('content-' + tab.id.split('-')[1]).classList.add('active');
    });
});

// --- Lógica de Carga de Archivos ---
fileLoader.addEventListener('change', e => handleFiles(e.target.files));

document.querySelector('label[for="fileLoader"]').addEventListener('click', (e) => {
    e.preventDefault();
    fileLoader.click();
});

function handleFiles(files) {
    imageFiles = Array.from(files).filter(file => file.type.startsWith('image/'));
    previewsContainer.innerHTML = '';
    
    if (imageFiles.length === 0) {
        analyzeButton.disabled = true;
        previewsContainerWrapper.classList.add('hidden');
        return;
    }

    previewsContainerWrapper.classList.remove('hidden');
    previewsHeader.textContent = `${imageFiles.length} muestras cargadas:`;
    imageFiles.forEach(file => {
        const reader = new FileReader();
        reader.onload = e => {
            const img = document.createElement('img');
            img.src = e.target.result;
            img.className = 'w-full h-20 object-cover rounded-md border';
            img.title = file.name;
            previewsContainer.appendChild(img);
        };
        reader.readAsDataURL(file);
    });
    
    analyzeButton.disabled = false;
}

// --- Lógica de Registro Automático de Datos ---
selectFolderButton.addEventListener('click', async () => {
    try {
        directoryHandle = await window.showDirectoryPicker();
        const options = { mode: 'readwrite' };
        if (await directoryHandle.queryPermission(options) !== 'granted') {
            if (await directoryHandle.requestPermission(options) !== 'granted') {
                folderStatus.textContent = 'Error: Permiso denegado para escribir en la carpeta.';
                folderStatus.classList.add('text-red-500');
                directoryHandle = null;
                return;
            }
        }
        folderStatus.textContent = `Registrando en: ${directoryHandle.name}`;
        folderStatus.classList.remove('text-red-500');
        folderStatus.classList.add('text-green-600');
    } catch (err) {
        console.error("Error al seleccionar la carpeta:", err);
        folderStatus.textContent = 'Selección de carpeta cancelada.';
        folderStatus.classList.remove('text-green-600');
    }
});

async function appendDataToLocalFile(results) {
    if (!directoryHandle) return;
    try {
        const fileHandle = await directoryHandle.getFileHandle('historial_analisis.csv', { create: true });
        const file = await fileHandle.getFile();
        const isNewFile = file.size === 0;

        const writable = await fileHandle.createWritable({ keepExistingData: true });
        await writable.seek(file.size);

        let contentToAppend = "";
        if (isNewFile) {
            contentToAppend += "Fecha,Muestra,Area Afectada (%),Numero Lesiones,Grado (0-5)\n";
        }
        
        const timestamp = new Date().toISOString();
        const rows = results.map(res => 
            `${timestamp},${res.fileName},${res.areaDamage.toFixed(2)},${res.lesionCount},${res.diseaseGrade}`
        ).join("\n");
        
        contentToAppend += rows + "\n";

        await writable.write(contentToAppend);
        await writable.close();
        console.log("Datos guardados exitosamente en historial_analisis.csv");
    } catch (err) {
        console.error("Error al guardar los datos automáticamente:", err);
        folderStatus.textContent = 'Error al guardar. Vuelva a seleccionar la carpeta.';
        folderStatus.classList.add('text-red-500');
        directoryHandle = null;
    }
}


// --- Lógica de Análisis (Comunicación con el Backend) ---
analyzeButton.addEventListener('click', async () => {
    if (imageFiles.length === 0) return;
    
    initialMessage.style.display = 'none';
    resultsContent.classList.add('hidden');
    downloadDataCSVButton.classList.add('hidden');
    progressContainer.classList.remove('hidden');
    analyzeButton.disabled = true;
    
    let processedCount = 0;
    const analysisResults = [];

    for (const file of imageFiles) {
        const formData = new FormData();
        formData.append("file", file);

        try {
            const response = await fetch(API_URL, {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error(`Error del servidor: ${response.statusText}`);
            }

            const data = await response.json();
            analysisResults.push({
                fileName: data.nombre_archivo,
                areaDamage: data.resultados.area_afectada_pct,
                lesionCount: data.resultados.conteo_lesiones,
                diseaseGrade: getDiseaseGrade(data.resultados.area_afectada_pct)
            });

        } catch (error) {
            console.error(`Error analizando ${file.name}:`, error);
            analysisResults.push({ fileName: file.name, error: true });
        }

        processedCount++;
        const percentage = Math.round((processedCount / imageFiles.length) * 100);
        progressBar.style.width = `${percentage}%`;
        progressLabel.textContent = `Analizando muestra ${processedCount} de ${imageFiles.length}...`;
        progressPercentage.textContent = `${percentage}%`;
    }
    
    const validResults = analysisResults.filter(r => !r.error);
    lastAnalysisResults = validResults;
    
    progressContainer.classList.add('hidden');
    
    if (validResults.length === 0) {
        initialMessage.innerHTML = `<p class="text-red-500 font-semibold">Análisis fallido.</p><p class="text-sm">No se pudo procesar ninguna imagen. Verifique que el servidor backend esté en ejecución.</p>`;
        initialMessage.style.display = 'block';
        analyzeButton.disabled = false;
        return;
    }
    
    if (directoryHandle) {
        await appendDataToLocalFile(validResults);
    }
    
    const summaryStats = calculateSummaryStats(validResults);
    displaySummary(summaryStats);
    displayDataTable(validResults);
    createCharts(validResults, summaryStats.gradeCounts);

    resultsContent.classList.remove('hidden');
    downloadDataCSVButton.classList.remove('hidden');
    document.getElementById('tab-summary').click();
    analyzeButton.disabled = false;
    imageFiles = [];
    previewsContainerWrapper.classList.add('hidden');
});


// --- Funciones de Visualización ---
function displaySummary(stats) {
    const container = document.getElementById('content-summary');
    container.innerHTML = `
        <h3 class="text-xl font-bold text-gray-800 text-center">Resumen Epidemiológico del Lote</h3>
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-blue-50 p-4 rounded-lg text-center border border-blue-200">
                <p class="text-sm text-blue-800 font-semibold">Incidencia de la Enfermedad</p>
                <p class="text-4xl font-bold text-blue-900">${stats.incidence.toFixed(1)}%</p>
                <p class="text-xs text-gray-500 mt-1">Proporción de muestras enfermas</p>
            </div>
            <div class="bg-red-50 p-4 rounded-lg text-center border border-red-200">
                <p class="text-sm text-red-800 font-semibold">Índice de Severidad (McKinney)</p>
                <p class="text-4xl font-bold text-red-900">${stats.mckinneyIndex.toFixed(1)}%</p>
                <p class="text-xs text-gray-500 mt-1">Severidad promedio del lote</p>
            </div>
        </div>
        <div class="bg-gray-50 p-4 rounded-lg border chart-container">
             <h4 class="font-bold text-gray-700 text-center mb-2">Distribución de Muestras por Grado de Severidad</h4>
             <canvas id="gradeHistogramChart"></canvas>
        </div>
    `;
}

function displayDataTable(results) {
    const container = document.getElementById('content-data');
    let tableHTML = `
        <div class="overflow-x-auto">
            <table class="min-w-full divide-y divide-gray-200">
                <thead class="bg-gray-50">
                    <tr>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Muestra</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Área Afectada (%)</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"># Lesiones</th>
                        <th class="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Grado (0-5)</th>
                    </tr>
                </thead>
                <tbody id="data-table-body" class="bg-white divide-y divide-gray-200">
    `;
    results.forEach(res => {
        tableHTML += `<tr>
            <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900 truncate" style="max-width: 150px;" title="${res.fileName}">${res.fileName}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500 font-semibold">${res.areaDamage.toFixed(2)}%</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${res.lesionCount}</td>
            <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${res.diseaseGrade}</td>
        </tr>`;
    });
    tableHTML += `</tbody></table></div>`;
    container.innerHTML = tableHTML;
}

function createCharts(results, gradeCounts) {
    const container = document.getElementById('content-charts');
    container.innerHTML = `
        <div id="charts-grid" class="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div class="relative p-2 border rounded-lg bg-white chart-container">
                <h4 class="font-bold text-gray-700 text-sm text-center mb-2">Área Afectada por Muestra</h4>
                <canvas id="damageBarChart"></canvas>
            </div>
            <div class="relative p-2 border rounded-lg bg-white chart-container">
                <h4 class="font-bold text-gray-700 text-sm text-center mb-2">Correlación: Área Afectada vs. # Lesiones</h4>
                <canvas id="scatterPlot"></canvas>
            </div>
        </div>
    `;

    const chartOptions = { 
        maintainAspectRatio: false, 
        animation: false,
        plugins: { 
            legend: { display: false },
            customCanvasBackgroundColor: { color: 'white' }
        }
    };

    new Chart(document.getElementById('gradeHistogramChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: ['Grado 0', 'Grado 1', 'Grado 2', 'Grado 3', 'Grado 4', 'Grado 5'],
            datasets: [{ label: '# de Muestras', data: gradeCounts, backgroundColor: 'rgba(22, 163, 74, 0.6)', borderColor: 'rgba(22, 163, 74, 1)', borderWidth: 1 }]
        },
        options: { ...chartOptions, scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } } }
    });

    new Chart(document.getElementById('damageBarChart').getContext('2d'), {
        type: 'bar',
        data: {
            labels: results.map(r => r.fileName),
            datasets: [{ label: 'Área Afectada (%)', data: results.map(r => r.areaDamage), backgroundColor: 'rgba(239, 68, 68, 0.6)', borderColor: 'rgba(239, 68, 68, 1)', borderWidth: 1 }]
        },
        options: { ...chartOptions, scales: { y: { beginAtZero: true, max: 100 } } }
    });

    new Chart(document.getElementById('scatterPlot').getContext('2d'), {
        type: 'scatter',
        data: {
            datasets: [{
                label: 'Muestras',
                data: results.map(r => ({ x: r.areaDamage, y: r.lesionCount })),
                backgroundColor: 'rgba(59, 130, 246, 0.7)'
            }]
        },
        options: {
            ...chartOptions,
            scales: {
                x: { title: { display: true, text: '% Área Afectada' }, min: 0, max: 100 },
                y: { title: { display: true, text: '# Lesiones' }, min: 0 }
            },
            plugins: { ...chartOptions.plugins, tooltip: { enabled: true, callbacks: { label: (c) => `Área: ${c.raw.x.toFixed(1)}%, Lesiones: ${c.raw.y}` } } }
        }
    });
}

// --- Funciones Epidemiológicas ---
function getDiseaseGrade(areaDamage) {
    if (areaDamage === 0) return 0;
    if (areaDamage <= 5) return 1;
    if (areaDamage <= 25) return 2;
    if (areaDamage <= 50) return 3;
    if (areaDamage <= 75) return 4;
    return 5;
}

function calculateSummaryStats(results) {
    const n = results.length;
    if (n === 0) return { incidence: 0, mckinneyIndex: 0, gradeCounts: [0,0,0,0,0,0] };
    
    const diseasedLeaves = results.filter(r => r.areaDamage > 0).length;
    const incidence = (diseasedLeaves / n) * 100;

    const gradeCounts = new Array(6).fill(0);
    results.forEach(r => {
        gradeCounts[r.diseaseGrade]++;
    });

    const sumOfGrades = gradeCounts.reduce((sum, count, grade) => sum + (count * grade), 0);
    const maxScore = n * 5;
    const mckinneyIndex = maxScore > 0 ? (sumOfGrades / maxScore) * 100 : 0;

    return { incidence, mckinneyIndex, gradeCounts };
}

// --- Lógica de Descarga CSV ---
downloadDataCSVButton.addEventListener('click', () => {
    if (lastAnalysisResults.length === 0) return;

    const header = "Muestra,Area Afectada (%),Numero Lesiones,Grado (0-5)\n";
    const rows = lastAnalysisResults.map(res => 
        `${res.fileName},${res.areaDamage.toFixed(2)},${res.lesionCount},${res.diseaseGrade}`
    ).join("\n");

    const csvContent = "data:text/csv;charset=utf-8," + encodeURIComponent(header + rows);
    const link = document.createElement("a");
    link.setAttribute("href", csvContent);
    
    const date = new Date();
    const batchId = `${date.getFullYear()}${(date.getMonth()+1).toString().padStart(2,'0')}${date.getDate().toString().padStart(2,'0')}`;
    link.setAttribute("download", `datos_fitopatologicos_${batchId}.csv`);
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});

# Trends Factory - Windows Setup Script
# Run: .\setup.ps1

Write-Host ""
Write-Host "====================================" -ForegroundColor Cyan
Write-Host "  TRENDS FACTORY - Setup Wizard" -ForegroundColor Cyan
Write-Host "====================================" -ForegroundColor Cyan
Write-Host ""

# Check Node.js
Write-Host "Checking Node.js..." -ForegroundColor Yellow
try {
    $nodeVersion = node --version
    Write-Host "  Node.js: $nodeVersion" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Node.js not found. Install from https://nodejs.org" -ForegroundColor Red
    exit 1
}

# Check FFmpeg
Write-Host "Checking FFmpeg..." -ForegroundColor Yellow
try {
    $ffmpegVersion = ffmpeg -version 2>&1 | Select-Object -First 1
    Write-Host "  FFmpeg: Found" -ForegroundColor Green
} catch {
    Write-Host "  WARNING: FFmpeg not found. Install from https://ffmpeg.org/download.html" -ForegroundColor Red
    Write-Host "  The pipeline will fail at video assembly without FFmpeg." -ForegroundColor Red
}

# Create .env file
Write-Host ""
Write-Host "Setting up environment..." -ForegroundColor Yellow

$envPath = Join-Path $PSScriptRoot ".env"

if (Test-Path $envPath) {
    Write-Host "  .env file already exists" -ForegroundColor Yellow
    $overwrite = Read-Host "  Overwrite? (y/N)"
    if ($overwrite -ne "y" -and $overwrite -ne "Y") {
        Write-Host "  Keeping existing .env file" -ForegroundColor Green
    } else {
        Remove-Item $envPath
    }
}

if (-not (Test-Path $envPath)) {
    Write-Host ""
    Write-Host "Enter your Gemini API Key:" -ForegroundColor Cyan
    Write-Host "(Get one at https://aistudio.google.com/app/apikey)" -ForegroundColor Gray
    $apiKey = Read-Host "API Key"

    if ([string]::IsNullOrWhiteSpace($apiKey)) {
        Write-Host "  ERROR: API key cannot be empty" -ForegroundColor Red
        exit 1
    }

    # Write .env file WITHOUT quotes
    $envContent = "GEMINI_API_KEY=$apiKey"
    [System.IO.File]::WriteAllText($envPath, $envContent)

    Write-Host "  .env file created successfully" -ForegroundColor Green
}

# Install dependencies
Write-Host ""
Write-Host "Installing dependencies..." -ForegroundColor Yellow
npm install

if ($LASTEXITCODE -eq 0) {
    Write-Host "  Dependencies installed" -ForegroundColor Green
} else {
    Write-Host "  ERROR: npm install failed" -ForegroundColor Red
    exit 1
}

# Done
Write-Host ""
Write-Host "====================================" -ForegroundColor Green
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "====================================" -ForegroundColor Green
Write-Host ""
Write-Host "Run the pipeline with:" -ForegroundColor Cyan
Write-Host "  npm run generate" -ForegroundColor White
Write-Host ""

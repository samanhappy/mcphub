import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { ApiResponse } from '../types/index.js';

// Get the directory name in ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../../data/uploads/dxt');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const timestamp = Date.now();
    const originalName = path.parse(file.originalname).name;
    cb(null, `${originalName}-${timestamp}.dxt`);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (file.originalname.endsWith('.dxt')) {
      cb(null, true);
    } else {
      cb(new Error('Only .dxt files are allowed'));
    }
  },
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB limit
  },
});

export const uploadMiddleware = upload.single('dxtFile');

// Clean up old DXT server files when installing a new version
const cleanupOldDxtServer = (serverName: string): void => {
  try {
    const uploadDir = path.join(__dirname, '../../data/uploads/dxt');
    const serverPattern = `server-${serverName}`;

    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      files.forEach((file) => {
        if (file.startsWith(serverPattern)) {
          const filePath = path.join(uploadDir, file);
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log(`Cleaned up old DXT server directory: ${filePath}`);
          }
        }
      });
    }
  } catch (error) {
    console.warn('Failed to cleanup old DXT server files:', error);
    // Don't fail the installation if cleanup fails
  }
};

export const uploadDxtFile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'No DXT file uploaded',
      });
      return;
    }

    const dxtFilePath = req.file.path;
    const timestamp = Date.now();
    const tempExtractDir = path.join(path.dirname(dxtFilePath), `temp-extracted-${timestamp}`);

    try {
      // Extract the DXT file (which is a ZIP archive) to a temporary directory first
      const zip = new AdmZip(dxtFilePath);
      zip.extractAllTo(tempExtractDir, true);

      // Read and validate the manifest.json
      const manifestPath = path.join(tempExtractDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('manifest.json not found in DXT file');
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // Validate required fields in manifest
      if (!manifest.dxt_version) {
        throw new Error('Invalid manifest: missing dxt_version');
      }
      if (!manifest.name) {
        throw new Error('Invalid manifest: missing name');
      }
      if (!manifest.version) {
        throw new Error('Invalid manifest: missing version');
      }
      if (!manifest.server) {
        throw new Error('Invalid manifest: missing server configuration');
      }

      // Use server name as the final extract directory for automatic version management
      const finalExtractDir = path.join(path.dirname(dxtFilePath), `server-${manifest.name}`);

      // Clean up any existing version of this server
      cleanupOldDxtServer(manifest.name);

      // Move the temporary directory to the final location
      fs.renameSync(tempExtractDir, finalExtractDir);
      console.log(`DXT server extracted to: ${finalExtractDir}`);

      // Clean up the uploaded DXT file
      fs.unlinkSync(dxtFilePath);

      const response: ApiResponse = {
        success: true,
        data: {
          manifest,
          extractDir: finalExtractDir,
        },
      };

      res.json(response);
    } catch (extractError) {
      // Clean up files on error
      if (fs.existsSync(dxtFilePath)) {
        fs.unlinkSync(dxtFilePath);
      }
      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
      throw extractError;
    }
  } catch (error) {
    console.error('DXT upload error:', error);

    let message = 'Failed to process DXT file';
    if (error instanceof Error) {
      message = error.message;
    }

    res.status(500).json({
      success: false,
      message,
    });
  }
};

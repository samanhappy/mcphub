import { Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import AdmZip from 'adm-zip';
import { ApiResponse } from '../types/index.js';

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const uploadDir = path.join(process.cwd(), 'data/uploads/mcpb');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const originalName = path.parse(file.originalname).name;
    cb(null, `${originalName}-${timestamp}.mcpb`);
  },
});

const upload = multer({
  storage,
  fileFilter: (_req, file, cb) => {
    if (file.originalname.endsWith('.mcpb')) {
      cb(null, true);
    } else {
      cb(new Error('Only .mcpb files are allowed'));
    }
  },
  limits: {
    fileSize: 500 * 1024 * 1024, // 500MB limit
  },
});

export const uploadMiddleware = upload.single('mcpbFile');

// Clean up old MCPB server files when installing a new version
const cleanupOldMcpbServer = (serverName: string): void => {
  try {
    const uploadDir = path.join(process.cwd(), 'data/uploads/mcpb');
    const serverPattern = `server-${serverName}`;

    if (fs.existsSync(uploadDir)) {
      const files = fs.readdirSync(uploadDir);
      files.forEach((file) => {
        if (file.startsWith(serverPattern)) {
          const filePath = path.join(uploadDir, file);
          if (fs.statSync(filePath).isDirectory()) {
            fs.rmSync(filePath, { recursive: true, force: true });
            console.log(`Cleaned up old MCPB server directory: ${filePath}`);
          }
        }
      });
    }
  } catch (error) {
    console.warn('Failed to cleanup old MCPB server files:', error);
    // Don't fail the installation if cleanup fails
  }
};

export const uploadMcpbFile = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        success: false,
        message: 'No MCPB file uploaded',
      });
      return;
    }

    const mcpbFilePath = req.file.path;
    const timestamp = Date.now();
    const tempExtractDir = path.join(path.dirname(mcpbFilePath), `temp-extracted-${timestamp}`);

    try {
      // Extract the MCPB file (which is a ZIP archive) to a temporary directory first
      const zip = new AdmZip(mcpbFilePath);
      zip.extractAllTo(tempExtractDir, true);

      // Read and validate the manifest.json
      const manifestPath = path.join(tempExtractDir, 'manifest.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error('manifest.json not found in MCPB file');
      }

      const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
      const manifest = JSON.parse(manifestContent);

      // Validate required fields in manifest
      if (!manifest.manifest_version) {
        throw new Error('Invalid manifest: missing manifest_version');
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
      const finalExtractDir = path.join(path.dirname(mcpbFilePath), `server-${manifest.name}`);

      // Clean up any existing version of this server
      cleanupOldMcpbServer(manifest.name);
      if (!fs.existsSync(finalExtractDir)) {
        fs.mkdirSync(finalExtractDir, { recursive: true });
      }

      // Move the temporary directory to the final location
      fs.renameSync(tempExtractDir, finalExtractDir);
      console.log(`MCPB server extracted to: ${finalExtractDir}`);

      // Clean up the uploaded MCPB file
      fs.unlinkSync(mcpbFilePath);

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
      if (fs.existsSync(mcpbFilePath)) {
        fs.unlinkSync(mcpbFilePath);
      }
      if (fs.existsSync(tempExtractDir)) {
        fs.rmSync(tempExtractDir, { recursive: true, force: true });
      }
      throw extractError;
    }
  } catch (error) {
    console.error('MCPB upload error:', error);

    let message = 'Failed to process MCPB file';
    if (error instanceof Error) {
      message = error.message;
    }

    res.status(500).json({
      success: false,
      message,
    });
  }
};

import React, { useState, useEffect  } from 'react';
import axios from 'axios';
import { openDB } from 'idb';

const CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
const DB_NAME = 'UploadDB';
const STORE_NAME = 'uploads';

const openUploadDB = () =>
  openDB(DB_NAME, 1, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME);
    },
  });

const S3Uploader = () => {
  const [progress, setProgress] = useState(0);

  const handleUpload = async (e) => {
    const file = e.target.files[0];
    await uploadFile(file);
  };
  

  const uploadFile = async (file, existingRecord = null) => {
    const fileKey = `${file.name}-${file.size}`;
    const db = await openUploadDB();
    let uploadState = existingRecord || await db.get(STORE_NAME, fileKey);
  
    let uploadId = uploadState?.uploadId;
    let uploadedParts = uploadState?.uploadedParts || [];
  
    if (!uploadId) {
      const { data } = await axios.post('http://localhost:3000/upload/start', {
        fileName: file.name,
        contentType: file.type,
      });
      uploadId = data.uploadId;
      uploadedParts = [];
    }
  
    const totalParts = Math.ceil(file.size / CHUNK_SIZE);
    const pendingParts = [];
  
    for (let i = 0; i < totalParts; i++) {
      const partNumber = i + 1;
      if (!uploadedParts.find((p) => p.PartNumber === partNumber)) {
        pendingParts.push(partNumber);
      }
    }
  
    const { data: { urls } } = await axios.post('http://localhost:3000/upload/presigned-urls', {
      fileName: file.name,
      uploadId,
      partNumbers: pendingParts,
    });
  
    for (const { partNumber, signedUrl } of urls) {
      const start = (partNumber - 1) * CHUNK_SIZE;
      const end = Math.min(file.size, start + CHUNK_SIZE);
      const chunk = file.slice(start, end);
  
      const res = await axios.put(signedUrl, chunk, {
        headers: { 'Content-Type': file.type },
      });
  
      uploadedParts.push({ PartNumber: partNumber, ETag: res.headers.etag });
  
      await db.put(STORE_NAME, {
        uploadId,
        uploadedParts,
        fileName: file.name,
        fileSize: file.size,
        fileType: file.type,
        lastModified: file.lastModified,
      }, fileKey);
  
      setProgress(Math.floor((uploadedParts.length / totalParts) * 100));
    }
  
    await axios.post('http://localhost:3000/upload/complete', {
      fileName: file.name,
      uploadId,
      parts: uploadedParts,
    });
  
    await db.delete(STORE_NAME, fileKey);
    alert('Upload complete!');
  };
  

  useEffect(() => {
    const resumeUploads = async () => {
      const db = await openUploadDB();
      const allKeys = await db.getAllKeys(STORE_NAME);
  
      for (const key of allKeys) {
        const record = await db.get(STORE_NAME, key);
        if (!record || !record.uploadId || !record.uploadedParts) continue;
  
        const fileHandle = await window.showOpenFilePicker({
          types: [{ description: 'Videos', accept: { 'video/*': ['.mp4', '.mov', '.mkv'] } }],
        });
  
        const file = await fileHandle[0].getFile();
  
        // Match file by name, size, and last modified
        if (
          file.name === record.fileName &&
          file.size === record.fileSize &&
          file.lastModified === record.lastModified
        ) {
          alert(`Resuming upload for ${file.name}`);
          uploadFile(file, record); // Call shared upload logic
        }
      }
    };
  
    resumeUploads();
  }, []);
  

  return (
    <div>
      <input type="file" onChange={handleUpload} />
      <p>Progress: {progress}%</p>
    </div>
  );
};

export default S3Uploader;

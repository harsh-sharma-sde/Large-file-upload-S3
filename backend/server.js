const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const routes = require('./uploadRoutes');
const AWS = require('aws-sdk');
const fs = require('fs');
const axios = require('axios');

dotenv.config();
const app = express();
app.use(cors());
app.use(express.json());
app.use('/upload', routes);

AWS.config.update({
    accessKeyId: '',
    secretAccessKey:  '',
    region: process.env.AWS_REGION || 'us-east-1'
  });
  
  const s3 = new AWS.S3();

// Configuration for video sources
const videoFileMap = {
    'nfc': { type: 's3', bucket:  's3-gamestats', key: 'uploads/ab5950f7-595b-4f9d-8b9e-ff4ceb522095/nfc.mp4' },
    'test_people': { type: 's3', bucket:  's3-gamestats', key: 'test_people.mp4' },
    'test': { type: 's3', bucket:  's3-gamestats', key: 'videoplayback.mp4' },
    // Add external URLs like this:
    's3-video': { type: 'remote', path: 'https://s3-gamestats.s3.amazonaws.com/uploads/ab5950f7-595b-4f9d-8b9e-ff4ceb522095/nfc.mp4' }
};

// Middleware to handle both local and remote videos
async function handleS3Video(bucket, key, req, res) {
    const range = req.headers.range;
    
    try {
        // Get file metadata first
        const headParams = {
            Bucket: bucket,
            Key: key
        };
        
        const headData = await s3.headObject(headParams).promise();
        const fileSize = headData.ContentLength;
        
        if (range) {
            // Handle range requests for partial content
            const parts = range.replace(/bytes=/, '').split('-');
            const start = parseInt(parts[0], 10);
            const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
            const chunksize = (end - start) + 1;
            console.log(`Streaming S3 video chunk: ${start}-${end}/${fileSize}`);
            const getParams = {
                Bucket: bucket,
                Key: key,
                Range: `bytes=${start}-${end}`
            };
            
            const s3Stream = s3.getObject(getParams).createReadStream();
            
            res.writeHead(206, {
                'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                'Accept-Ranges': 'bytes',
                'Content-Length': chunksize,
                'Content-Type': headData.ContentType || 'video/mp4'
            });
            
            s3Stream.pipe(res);
        } else {
            // Full file request
            const getParams = {
                Bucket: bucket,
                Key: key
            };
            
            const s3Stream = s3.getObject(getParams).createReadStream();
            
            res.writeHead(200, {
                'Content-Length': fileSize,
                'Content-Type': headData.ContentType || 'video/mp4'
            });
            
            s3Stream.pipe(res);
        }
    } catch (error) {
        console.error('S3 streaming error:', error);
        if (error.code === 'NoSuchKey') {
            res.status(404).send('File not found');
        } else {
            res.status(500).send('Error streaming video');
        }
    }
}

// Handle local file streaming
async function handleLocalVideo(filePath, req, res) {
    if (!fs.existsSync(filePath)) {
        return res.status(404).send('Local file not found');
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        
        console.log(`Streaming local video chunk: ${start}-${end}/${fileSize}`);
        
        const file = fs.createReadStream(filePath, { start, end });
        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': 'video/mp4'
        };
        
        res.writeHead(206, head);
        file.pipe(res);
    } else {
        console.log('Full local video request');
        const head = {
            'Content-Length': fileSize,
            'Content-Type': 'video/mp4'
        };
        res.writeHead(200, head);
        fs.createReadStream(filePath).pipe(res);
    }
}

// Handle remote URL streaming
async function handleRemoteVideo(url, req, res) {
    const range = req.headers.range;
    
    if (!range) {
        // For non-range requests, just proxy the video
        try {
            const response = await axios({
                method: 'get',
                url: url,
                responseType: 'stream'
            });
            
            res.setHeader('Content-Type', response.headers['content-type'] || 'video/mp4');
            response.data.pipe(res);
        } catch (error) {
            console.error('Error proxying remote video:', error);
            res.status(500).send('Error fetching remote video');
        }
        return;
    }

    try {
        // First, get the file size with a HEAD request
        const headResponse = await axios.head(url);
        const fileSize = parseInt(headResponse.headers['content-length'], 10);
        
        if (!fileSize) {
            throw new Error('Could not determine remote file size');
        }

        const parts = range.replace(/bytes=/, '').split('-');
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
        const chunksize = end - start + 1;
        
        console.log(`Streaming remote video chunk: ${start}-${end}/${fileSize}`);
        
        const response = await axios({
            method: 'get',
            url: url,
            headers: {
                Range: `bytes=${start}-${end}`,
                'Accept-Encoding': 'identity'
            },
            responseType: 'stream'
        });

        const head = {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunksize,
            'Content-Type': response.headers['content-type'] || 'video/mp4'
        };
        
        res.writeHead(206, head);
        response.data.pipe(res);
    } catch (error) {
        console.error('Error streaming remote video:', error);
        res.status(500).send('Error streaming remote video');
    }
}

// Update your route handler
app.get('/videos/:filename', async (req, res) => {
    const fileName = req.params.filename;
    const videoConfig = videoFileMap[fileName];
    
    if (!videoConfig) {
        return res.status(404).send('File not found in configuration');
    }

    try {
        if (videoConfig.type === 'local') {
            await handleLocalVideo(videoConfig.path, req, res);
        } else if (videoConfig.type === 's3') {
            await handleS3Video(videoConfig.bucket, videoConfig.key, req, res);
        } else {
            return res.status(400).send('Invalid video source type');
        }
    } catch (error) {
        console.error('Error streaming video:', error);
        res.status(500).send('Error streaming video');
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

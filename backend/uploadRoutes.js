const express = require('express');
const {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const router = express.Router();

const s3 = new S3Client({
  region: '',
  credentials: {
    accessKeyId: '',
    secretAccessKey: '',
  },
});
const BUCKET = '';

router.post('/start', async (req, res) => {
  const { fileName, contentType } = req.body;

  const command = new CreateMultipartUploadCommand({
    Bucket: BUCKET,
    Key: fileName,
    ContentType: contentType,
  });

  const { UploadId } = await s3.send(command);
  res.json({ uploadId: UploadId });
});

router.post('/presigned-urls', async (req, res) => {
  const { fileName, uploadId, partNumbers } = req.body;

  const urls = await Promise.all(
    partNumbers.map(async (partNumber) => {
      const command = new UploadPartCommand({
        Bucket: BUCKET,
        Key: fileName,
        UploadId: uploadId,
        PartNumber: partNumber,
      });
      const signedUrl = await getSignedUrl(s3, command, { expiresIn: 3600 });
      return { partNumber, signedUrl };
    })
  );

  res.json({ urls });
});

router.post('/complete', async (req, res) => {
  const { fileName, uploadId, parts } = req.body;

  const command = new CompleteMultipartUploadCommand({
    Bucket: BUCKET,
    Key: fileName,
    UploadId: uploadId,
    MultipartUpload: {
      Parts: parts,
    },
  });

  const result = await s3.send(command);
  console.log('Upload completed:', result.Location);
  res.json({ success: true, location: result.Location });
});

module.exports = router;

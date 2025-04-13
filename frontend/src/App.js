import S3Uploader from './S3Uploader';
import './App.css';
import React, { useState } from 'react';
import VideoPlayer from './VideoPlayer';

function App() {
  const [videoId, setVideoId] = useState(null)

  function playVideo(e, videoId){
    e.preventDefault()
    setVideoId(videoId)
  }
  return (
    <div className="App">
      <S3Uploader />

      <br></br>

      <div className="App">
      {videoId && <VideoPlayer videoId={videoId}></VideoPlayer>} <br />
      <button onClick={(e)=>{playVideo(e, 'nfc')}}>Play Video 1</button>
      <button onClick={(e)=>{playVideo(e, 'test_people')}}>Play Video 2</button>
      <button onClick={(e)=>{playVideo(e, 'test')}}>Play Video 3</button> 
    </div>
    </div>
  );
}

export default App;

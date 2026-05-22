import { useEffect, useRef, useState } from 'react'
import { io } from '../node_modules/socket.io-client/dist/socket.io.esm.min.js'

const API_BASE = 'https://anonymous-chatting-website.onrender.com'
const socket = io(API_BASE, {
  transports: ['websocket', 'polling'],
})

function JoinRoom({ onJoin, toggleBwMode, bwMode }) {
  const [roomCode, setRoomCode] = useState('')
  const [error, setError] = useState('')
  const [rooms, setRooms] = useState([])

  useEffect(() => {
    loadRooms()
  }, [])

  async function loadRooms() {
    try {
      const response = await fetch(`${API_BASE}/api/rooms`)
      if (response.ok) {
        const data = await response.json()
        setRooms(data)
      }
    } catch (loadError) {
      console.error('Failed to fetch rooms', loadError)
    }
  }

  function handleJoin() {
    if (!roomCode.trim()) {
      setError('Enter room code')
      return
    }

    onJoin(roomCode.trim().toUpperCase())
    setError('')
  }

  async function handleCreateRoom() {
    const newCode = Math.random().toString(36).substring(2, 8).toUpperCase()

    try {
      const response = await fetch(`${API_BASE}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: newCode }),
      })

      if (response.ok) {
        onJoin(newCode)
        setError('')
        return
      }

      const data = await response.json()
      setError(data.error || 'Failed to create room')
    } catch (createError) {
      setError('Server error')
      console.error(createError)
    }
  }

  return (
    <div className="join-room">
      <button
        onClick={toggleBwMode}
        style={{
          position: 'absolute',
          top: '10px',
          right: '10px',
          background: 'transparent',
          border: 'none',
          fontSize: '20px',
          cursor: 'pointer',
        }}
      >
        {bwMode ? '🌞' : '🌙'}
      </button>

      <h2>Join Anonymous Chat</h2>

      {error && <p className="error">{error}</p>}

      <input
        value={roomCode}
        onChange={(event) => setRoomCode(event.target.value)}
        placeholder="Enter room code"
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            handleJoin()
          }
        }}
      />

      <div style={{ marginTop: '12px' }}>
        <button onClick={handleJoin}>Join Room</button>
        <button onClick={handleCreateRoom} style={{ marginLeft: '8px' }}>
          Create New Room
        </button>
      </div>

      {rooms.length > 0 && (
        <div className="existing-rooms" style={{ marginTop: '20px' }}>
          <h3>Existing Rooms:</h3>
          <ul>
            {rooms.map((room) => (
              <li
                key={room}
                style={{ cursor: 'pointer', color: 'blue' }}
                onClick={() => onJoin(room)}
              >
                {room}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

function ChatRoom({ roomCode, onLeave, toggleBwMode, bwMode }) {
  const [messages, setMessages] = useState([])
  const [message, setMessage] = useState('')
  const [isUploading, setIsUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const fileInputRef = useRef(null)
  const messagesRef = useRef(null)

  useEffect(() => {
    socket.emit('joinRoom', roomCode)

    const handleLoadMessages = (loadedMessages) => setMessages(loadedMessages)
    const handleNewMessage = (incomingMessage) =>
      setMessages((currentMessages) => [...currentMessages, incomingMessage])

    socket.on('loadMessages', handleLoadMessages)
    socket.on('newMessage', handleNewMessage)

    return () => {
      socket.off('loadMessages', handleLoadMessages)
      socket.off('newMessage', handleNewMessage)
    }
  }, [roomCode])

  useEffect(() => {
    if (messagesRef.current) {
      messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }
  }, [messages])

  async function handleSendMessage() {
    if (!message.trim()) {
      return
    }

    const trimmedMessage = message.trim()

    try {
      const response = await fetch(`${API_BASE}/api/rooms/${roomCode}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: trimmedMessage,
          user: 'Anonymous',
          type: 'text',
        }),
      })

      if (response.ok) {
        setMessage('')

        const refreshedResponse = await fetch(`${API_BASE}/api/rooms/${roomCode}/messages`)
        if (refreshedResponse.ok) {
          const refreshedMessages = await refreshedResponse.json()
          setMessages(refreshedMessages)
        }
        return
      }

      const data = await response.json().catch(() => ({}))
      alert(data.error || 'Failed to send message')
    } catch (sendError) {
      console.error('Failed to send message', sendError)
      alert('Failed to send message')
    }
  }

  async function handleFileChange(event) {
    const selectedFile = event.target.files[0]
    if (!selectedFile) {
      return
    }

    setIsUploading(true)
    setUploadProgress(0)

    const formData = new FormData()
    formData.append('file', selectedFile)
    formData.append('roomCode', roomCode)
    formData.append('user', 'Anonymous')

    try {
      const request = new XMLHttpRequest()
      request.open('POST', `${API_BASE}/api/upload`, true)

      request.upload.onprogress = (progressEvent) => {
        if (progressEvent.lengthComputable) {
          const progress = Math.round((progressEvent.loaded / progressEvent.total) * 100)
          setUploadProgress(progress)
        }
      }

      request.onload = () => {
        setIsUploading(false)
        setUploadProgress(0)

        if (request.status === 200) {
          const data = JSON.parse(request.responseText)
          const filePayload = {
            url: data.url,
            originalName: data.originalName,
            size: data.size,
            mimeType: data.mimetype,
          }

          socket.emit('sendMessage', {
            roomCode,
            user: 'Anonymous',
            type: 'file',
            file: filePayload,
          })
          return
        }

        console.error('Upload failed', request.responseText)
        alert('Upload failed')
      }

      request.onerror = () => {
        setIsUploading(false)
        setUploadProgress(0)
        alert('Upload error')
      }

      request.send(formData)
    } catch (uploadError) {
      console.error(uploadError)
      setIsUploading(false)
      setUploadProgress(0)
      alert('Upload exception')
    } finally {
      event.target.value = ''
    }
  }

  return (
    <div className="chat-room dark">
      <div className="chat-header">
        <button
          onClick={toggleBwMode}
          style={{
            position: 'absolute',
            top: '10px',
            right: '10px',
            background: 'transparent',
            border: 'none',
            fontSize: '20px',
            cursor: 'pointer',
          }}
        >
          {bwMode ? '🌞' : '🌙'}
        </button>
        <h2>Room: {roomCode}</h2>
        <button className="leave" onClick={onLeave}>
          Leave Room
        </button>
      </div>

      <div className="messages" ref={messagesRef}>
        {messages.length === 0 && <p className="empty">No messages yet — say hi 👋</p>}

        {messages.map((entry) => {
          if (entry.type === 'file' && entry.file) {
            const isImage = entry.file.mimeType?.startsWith?.('image/')

            return (
              <div className="message" key={entry.id || entry._id}>
                <span className="user">{entry.user}:</span>
                {isImage ? (
                  <div className="file-preview">
                    <img src={entry.file.url} alt={entry.file.originalName} />
                    <div className="file-meta">
                      <span>{entry.file.originalName}</span>
                      <span>{Math.round((entry.file.size || 0) / 1024)} KB</span>
                    </div>
                  </div>
                ) : (
                  <div className="file-link">
                    <a href={entry.file.url} rel="noreferrer">
                      {entry.file.originalName}
                    </a>
                    <span className="file-size">
                      {Math.round((entry.file.size || 0) / 1024)} KB
                    </span>
                  </div>
                )}
              </div>
            )
          }

          return (
            <div className="message" key={entry.id || entry._id}>
              <span className="user">{entry.user}:</span> {entry.text}
            </div>
          )
        })}
      </div>

      <div className="message-input">
        <div className="attach-area">
          <button className="attach-btn" onClick={() => fileInputRef.current?.click()}>
            📎 Attach
          </button>
          <input
            ref={fileInputRef}
            type="file"
            style={{ display: 'none' }}
            onChange={handleFileChange}
          />
        </div>

        <input
          type="text"
          placeholder="Message"
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              handleSendMessage()
            }
          }}
        />
        <button onClick={handleSendMessage}>Send</button>
      </div>

      {isUploading && (
        <div className="upload-bar">
          <div className="upload-progress" style={{ width: `${uploadProgress}%` }} />
          <div className="upload-text">Uploading... {uploadProgress}%</div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const [activeRoom, setActiveRoom] = useState(null)
  const [bwMode, setBwMode] = useState(false)

  return (
    <div className={`app ${bwMode ? 'bw-mode' : ''}`}>
      {activeRoom ? (
        <ChatRoom
          roomCode={activeRoom}
          onLeave={() => setActiveRoom(null)}
          toggleBwMode={() => setBwMode((current) => !current)}
          bwMode={bwMode}
        />
      ) : (
        <JoinRoom
          onJoin={setActiveRoom}
          toggleBwMode={() => setBwMode((current) => !current)}
          bwMode={bwMode}
        />
      )}

      <div
        className="instagram-icon"
        onClick={() => {
          window.open('https://www.instagram.com/_.deon_37/', '_blank')
        }}
      >
        <svg viewBox="0 0 24 24">
          <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z" />
        </svg>
      </div>
    </div>
  )
}

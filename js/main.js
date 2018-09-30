'use strict';


/****************************************************************************
 * Initial setup
 ****************************************************************************/


// Establish the options.
var channelOptions = {
    ordered: true,
    reliable: true
};

var peerConfig = null;

// Collect and modify the necessary elements.
var messageField = document.getElementById("text-field");
messageField.placeholder = 'Enter a message and click send';

var chatOutput = document.getElementById("chat-output");

var sendButton = document.getElementById("send-button");
sendButton.addEventListener("click", sendText);


// Create a random room if not already present in the URL.
var isInitiator;
var room = window.location.hash.substring(1);
if (!room) {
    room = window.location.hash = randomToken();
}

var id = Math.round(Math.random() * 1000);


/****************************************************************************
 * Signaling server
 ****************************************************************************/


// Connect to the signaling server
var socket = io.connect();

socket.on('ipaddr', function(ipaddr) {
    console.log('Server IP address is: ' + ipaddr);
    // updateRoomURL(ipaddr);
});

socket.on('created', function(room, clientId) {
    console.log('Created room', room, '- my client ID is', clientId);
    isInitiator = true;
});

socket.on('joined', function(room, clientId) {
    console.log('This peer has joined room', room, 'with client ID', clientId);
    isInitiator = false;
    createPeerConnection(isInitiator, peerConfig);
});

socket.on('full', function(room) {
    alert('Room ' + room + ' is full. We will create a new room for you.');
    window.location.hash = '';
    window.location.reload();
});

socket.on('ready', function() {
    console.log('Socket is ready');
    createPeerConnection(isInitiator, peerConfig);
});

socket.on('log', function(array) {
    console.log.apply(console, array);
});

socket.on('message', function(message) {
    console.log('Client received message:', message);
    signalingMessageCallback(message);
});

// Join a room
socket.emit('create or join', room);

if (location.hostname.match(/localhost|127\.0\.0/)) {
    socket.emit('ipaddr');
}


/**
 * Send message to signaling server
 */
function sendMessage(message) {
    console.log('Client sending message: ', message);
    socket.emit('message', message);
}


/****************************************************************************
 * WebRTC peer connection and data channel
 ****************************************************************************/


var peerConn;
var dataChannel;

function signalingMessageCallback(message) {
    if (message.type === 'offer') {
        console.log('Got offer. Sending answer to peer.');
        peerConn.setRemoteDescription(new RTCSessionDescription(message), function() {}, logError);
        peerConn.createAnswer(onLocalSessionCreated, logError);

    } else if (message.type === 'answer') {
        console.log('Got answer.');
        peerConn.setRemoteDescription(new RTCSessionDescription(message), function() {}, logError);
    } else if (message.type === 'candidate') {
        peerConn.addIceCandidate(new RTCIceCandidate({
            candidate: message.candidate
        }));

    } else if (message === 'bye') {}
}

function createPeerConnection(isInitiator, config) {
    console.log('Creating Peer connection as initiator?', isInitiator, 'config:', config);
    peerConn = new RTCPeerConnection(config);

    // Send any ice candidates to the other peer
    peerConn.onicecandidate = function(event) {
        console.log('icecandidate event:', event);
        if (event.candidate) {
            sendMessage({
                type: 'candidate',
                label: event.candidate.sdpMLineIndex,
                id: event.candidate.sdpMid,
                candidate: event.candidate.candidate
            });
        } else {
            console.log('End of candidates.');
        }
    };

    if (isInitiator) {
        console.log('Creating Data Channel');
        dataChannel = peerConn.createDataChannel('photos', channelOptions);
        onDataChannelCreated(dataChannel);

        console.log('Creating an offer');
        peerConn.createOffer(onLocalSessionCreated, logError);
    } else {
        peerConn.ondatachannel = function(event) {
            console.log('ondatachannel:', event.channel);
            dataChannel = event.channel;
            onDataChannelCreated(dataChannel);
        };
    }

}

function onLocalSessionCreated(desc) {
    console.log('local session created:', desc);
    peerConn.setLocalDescription(desc, function() {
        console.log('sending local desc:', peerConn.localDescription);
        sendMessage(peerConn.localDescription);
    }, logError);
}

function onDataChannelCreated(channel) {
    console.log('onDataChannelCreated:', channel);

    channel.onopen = function() {
        console.log('CHANNEL opened!!!');
    };

    channel.onmessage = (adapter.browserDetails.browser === 'firefox') ?
        receiveDataFirefoxFactory() : receiveDataChromeFactory();
}


/****************************************************************************
 * Receive data factories
 ****************************************************************************/


function receiveDataChromeFactory() {
    return function onMessage(event) {
        var data = JSON.parse(event.data).data;
        if (!data){
            return;
        }
        if (typeof data === "string") {
            var byteSize = (new TextEncoder('utf-8').encode(event.data)).length;
            console.log("Data size: " + byteSize + " bytes");
            chatOutput.innerHTML = `${data}<br/>${chatOutput.innerHTML}`;
        } else {
            if (!!data.x && !!data.y && !!data.id && data.id !== id) {
                var cursor = document.getElementById(data.id);
                if (!cursor) {
                    cursor = document.createElement("div");
                    cursor.id = data.id;
                    cursor.classList.add("cursor");
                    document.body.appendChild(cursor);
                }
                cursor.style.left = `${data.x}px`;
                cursor.style.top = `${data.y}px`;
            }

        }
    };
}

/*
function receiveDataFirefoxFactory() {
  var count, total, parts;

  return function onmessage(event) {
    if (typeof event.data === 'string') {
      total = parseInt(event.data);
      parts = [];
      count = 0;
      console.log('Expecting a total of ' + total + ' bytes');
      return;
    }

    parts.push(event.data);
    count += event.data.size;
    console.log('Got ' + event.data.size + ' byte(s), ' + (total - count) +
                ' to go.');

    if (count === total) {
      console.log('Assembling payload');
      var buf = new Uint8ClampedArray(total);
      var compose = function(i, pos) {
        var reader = new FileReader();
        reader.onload = function() {
          buf.set(new Uint8ClampedArray(this.result), pos);
          if (i + 1 === parts.length) {
            console.log('Done. Rendering photo.');
            //renderPhoto(buf);
          } else {
            compose(i + 1, pos + this.result.byteLength);
          }
        };
        reader.readAsArrayBuffer(parts[i]);
      };
      compose(0, 0);
    }
  };
} */


/****************************************************************************
 * Aux functions, mostly UI-related
 ****************************************************************************/


function sendText(){
    var message = messageField.value;
    var data = {data: `${message}`};
    messageField.value = '';
    chatOutput.innerHTML = `${message}<br/>${chatOutput.innerHTML}`;
    dataChannel.send(JSON.stringify(data));
}

function mouseMove(event){
    var x = event.clientX;
    var y = event.clientY;
    var position = {data: {x: x, y: y, id: id}};
    dataChannel.send(JSON.stringify(position));
}

function randomToken() {
    return Math.floor((1 + Math.random()) * 1e16).toString(16).substring(1);
}

function logError(err) {
    console.log(err.toString(), err);
}

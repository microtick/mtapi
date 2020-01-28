class Protocol {
  
  constructor(timeout, requestHandler, eventHandler, sendHandler) {
    this.timeout = timeout
    this.nonce = 0
    this.pending = {}
    this.timeouts = {}
    
    this.requestHandler = requestHandler
    this.eventHandler = eventHandler
    this.sendHandler = sendHandler
  }
  
  async newMessage(name, payload) {
    const msg = new Message({
      id: this.nonce++, 
      type: 'request', 
      name: name, 
      payload: payload
    })
    const str = msg.serialize()
    this.sendHandler(str)
    const promise = new Promise((res, rej) => {
      this.pending[msg.id] = res
      this.timeouts[msg.id] = setTimeout(() => {
        delete this.pending[msg.id]
        delete this.timeouts[msg.id]
        rej()
      }, this.timeout)
    })
    return promise
  }
  
  createEvent(type, name, payload) {
    const msg = new Message({
      type: type,
      name: name,
      payload: payload
    })
    return msg.serialize()
  }
  
  async process(env, str) {
    const obj = JSON.parse(str)
    const msg = new Message(obj)
    if (msg.type === 'request') {
      const responsePayload = await this.requestHandler(env, msg.name, msg.payload)
      const response = new Message({
        id: msg.id, 
        type: 'response', 
        name: msg.name,
        payload: responsePayload
      })
      return response.serialize()
    } else if (msg.type === 'response') {
      if (this.pending[msg.id] !== undefined) {
        this.pending[msg.id](obj.payload)
        clearTimeout(this.timeouts[msg.id])
        delete this.pending[msg.id]
        delete this.timeouts[msg.id]
      }
    } else {
      await this.eventHandler(env, msg)
    }
  }
  
}

class Message {
  
  constructor(obj) {
    this.id = obj.id
    this.type = obj.type
    this.name = obj.name
    this.payload = obj.payload === undefined ? {} : obj.payload
  }
  
  serialize() {
    return JSON.stringify({
      id: this.id,
      type: this.type,
      name: this.name,
      payload: this.payload
    })
  }
  
}

module.exports = Protocol

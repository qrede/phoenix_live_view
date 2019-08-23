/*
================================================================================
Phoenix LiveView JavaScript Client
================================================================================

## Usage

Instantiate a single LiveSocket instance to enable LiveView
client/server interaction, for example:

    import LiveSocket from "phoenix_live_view"

    let liveSocket = new LiveSocket("/live")
    liveSocket.connect()

All options are passed directly to the `Phoenix.Socket` constructor,
except for the following LiveView specific options:

  * `bindingPrefix` - the prefix to use for phoenix bindings. Defaults `"phx-"`
  * `params` - the `connect_params` to pass to the view's mount callback. May be
    a literal object or closure returning an object. When a closure is provided,
    the function receives the view's phx-view name.
  * `hooks` – a reference to a user-defined hooks namespace, containing client
    callbacks for server/client interop. See the interop section below for details.

## Events

### Click Events

When pushed, the value sent to the server will be chosen with the
following priority:

  - An optional `"phx-value"` binding on the clicked element
  - The clicked element's `value` property
  - An empty string

### Key Events

The onkeydown and onkeyup events are supported via
the `phx-keydown`, and `phx-keyup` bindings. By
default, the bound element will be the event listener, but an
optional `phx-target` may be provided which may be `"window"`.

When pushed, the value sent to the server will be the event's `key`.

### Focus and Blur Events

Focus and blur events may be bound to DOM elements that emit
such events, using the `phx-blur`, and `phx-focus` bindings, for example:

    <input name="email" phx-focus="myfocus" phx-blur="myblur"/>

To detect when the page itself has receive focus or blur,
`phx-target` may be specified as `"window"`. Like other
bindings, a `phx-value` can be provided on the bound element,
otherwise the input's value will be used. For example:

    <div class="container"
        phx-focus="page-active"
        phx-blur="page-inactive"
        phx-target="window">
    ...
    </div>

## Forms and input handling

The JavaScript client is always the source of truth for current
input values. For any given input with focus, LiveView will never
overwrite the input's current value, even if it deviates from
the server's rendered updates. This works well for updates where
major side effects are not expected, such as form validation errors,
or additive UX around the user's input values as they fill out a form.
For these use cases, the `phx-change` input does not concern itself
with disabling input editing while an event to the server is inflight.

The `phx-submit` event is used for form submissions where major side-effects
typically happen, such as rendering new containers, calling an external
service, or redirecting to a new page. For these use-cases, the form inputs
are set to `readonly` on submit, and any submit button is disabled until
the client gets an acknowledgment that the server has processed the
`phx-submit` event. Following an acknowledgment, any updates are patched
to the DOM as normal, and the last input with focus is restored if the
user has not otherwise focused on a new input during submission.

To handle latent form submissions, any HTML tag can be annotated with
`phx-disable-with`, which swaps the element's `innerText` with the provided
value during form submission. For example, the following code would change
the "Save" button to "Saving...", and restore it to "Save" on acknowledgment:

    <button type="submit" phx-disable-with="Saving...">Save</button>


## Loading state and Errors

By default, the following classes are applied to the live view's parent
container:

  - `"phx-connected"` - applied when the view has connected to the server
  - `"phx-disconnected"` - applied when the view is not connected to the server
  - `"phx-error"` - applied when an error occurs on the server. Note, this
    class will be applied in conjunction with `"phx-disconnected"` if connection
    to the server is lost.

When a form bound with `phx-submit` is submitted, the `phx-loading` class
is applied to the form, which is removed on update.

## Custom JS Interop and client controlled DOM

A container can be marked with `phx-update`, allowing the DOM patch
operations to avoid updating or removing portions of the LiveView, or to append
or prepend the updates rather than replacing the existing contents. This
is useful for client-side interop with existing libraries that do their
own DOM operations. The following `phx-update` values are supported:

  * replace - the default operation. Replaces the element with the contents
  * ignore - ignores updates the DOM regardless of new content changes
  * append - append the new DOM contents instead of replacing
  * prepend - prepend the new DOM contents instead of replacing

To handle custom client-side javascript when an element is added, updated,
or removed by the server, a hook object may be provided with the following
life-cycle callbacks:

  * mounted - the element has been added to the DOM and its server
    LiveView has finished mounting
  * updated - the element has been updated in the DOM by the server
  * destroyed - the element has been removed from the page, either 
    by a parent update, or the parent being removed entirely
  * disconnected - the element's parent LiveView has disconnected from the server
  * reconnected - the element's parent LiveView has reconnected to the server

  In addition to the callbacks, the callbacks contain the following attributes in scope:
  
    * el - attribute referencing the bound DOM node,
    * viewName - attribute matching the dom node's phx-view value
    * pushEvent(event, payload) - method to push an event from the client to the LiveView server

  For example, a controlled input for phone-number formatting would annotate their
  markup:

      <input type="text" name="user[phone_number]" phx-hook="PhoneNumber"/>

  Then a hook callback object can be defined and passed to the socket:

      let Hooks = {}
      Hooks.PhoneNumber = {
        mounted(){
          this.el.addEventListener("input", e => {
            let match = this.el.value.replace(/\D/g, "").match(/^(\d{3})(\d{3})(\d{4})$/)
            if(match) {
              this.el.value = `${match[1]}-${match[2]}-${match[3]}`
            }
          })
        }
      }

      let liveSocket = new LiveSocket("/socket", {hooks: Hooks})
      ...
*/

import morphdom from "morphdom"
import {Socket} from "phoenix"

const PHX_VIEW = "data-phx-view"
const PHX_LIVE_LINK = "data-phx-live-link"
const PHX_CONNECTED_CLASS = "phx-connected"
const PHX_LOADING_CLASS = "phx-loading"
const PHX_DISCONNECTED_CLASS = "phx-disconnected"
const PHX_ERROR_CLASS = "phx-error"
const PHX_PARENT_ID = "data-phx-parent-id"
const PHX_VIEW_SELECTOR = `[${PHX_VIEW}]`
const PHX_ERROR_FOR = "data-phx-error-for"
const PHX_HAS_FOCUSED = "phx-has-focused"
const PHX_BOUND = "data-phx-bound"
const FOCUSABLE_INPUTS = ["text", "textarea", "number", "email", "password", "search", "tel", "url"]
const PHX_HAS_SUBMITTED = "phx-has-submitted"
const PHX_SESSION = "data-phx-session"
const PHX_STATIC = "data-phx-static"
const PHX_READONLY = "data-phx-readonly"
const PHX_DISABLED = "data-phx-disabled"
const PHX_DISABLE_WITH = "disable-with"
const PHX_HOOK = "hook"
const PHX_UPDATE = "update"
const LOADER_TIMEOUT = 1
const BEFORE_UNLOAD_LOADER_TIMEOUT = 200
const BINDING_PREFIX = "phx-"
const PUSH_TIMEOUT = 30000
const LINK_HEADER = "x-requested-with"

export let debug = (view, kind, msg, obj) => {
  console.log(`${view.id} ${kind}: ${msg} - `, obj)
}


// wraps value in closure or returns closure
let closure = (val) => typeof val === "function" ? val : function(){ return val }

let clone = (obj) => { return JSON.parse(JSON.stringify(obj)) }

let closestPhxBinding = (el, binding) => {
  do {
    if(el.matches(`[${binding}]`)){ return el }
    el = el.parentElement || el.parentNode
  } while(el !== null && el.nodeType === 1 && !el.matches(PHX_VIEW_SELECTOR))
  return null
}

let isObject = (obj) => {
  return obj !== null && typeof obj === "object" && !(obj instanceof Array)
}

let isEmpty = (obj) => {
  for (let x in obj){ return false }
  return true
}

let maybe = (el, key) => {
  if(el){
    return el[key]
  } else {
    return null
  }
}

let gatherFiles = (form) => {
  const formData = new FormData(form)
  let files = {}
  formData.forEach((val, key) => {
    if (val instanceof File && val.size > 0) {
      files[key] = val
    }
  })
  return files
}



let uploadFiles = (ctx, files, callback) => {
  let numFiles = Object.keys(files).length;
  let results = {};

  // TODO: leaves channels on error and rejoins when main live view joins
  // ctx.channel.onError(() => {
  // uploadChannels.leave()
  // }
  // i
  // onJoined(() => {
  // uploadChannels.reJoin()
  // }
  for(let key in files){
    ctx.channel.push("get_upload_ref").receive("ok", ({ ref }) => {

      const uploadChannel = ctx.liveSocket.channel(`lvu:${ctx.id}-${ctx.uploadCount++}`, () => {
        return {session: ctx.getSession(), ref}
      });

      // ctx.files.push(uploadChannel);

      const chunkReaderBlock = function(_offset, length, _file, handler) {
        var r = new window.FileReader();
        var blob = _file.slice(_offset, length + _offset);
        r.onload = handler;
        r.readAsArrayBuffer(blob);
      }

      uploadChannel.join().receive("ok", (data) => {
        let file = files[key]
        const uploadChunk = (chunk, finished, uploaded) => {
          if (!finished) {
            const percentage = Math.round((uploaded / file.size) * 100);
            ctx.pushWithReply("upload_progress", {path: key, size: file.size, uploaded, percentage})
          }

          uploadChannel.push("file", {file: chunk})
            .receive("ok", (data) => {
              if (finished) {
                results[key] = Object.assign(data, { topic: uploadChannel.topic });
                numFiles--;
                if (numFiles === 0) {
                  callback(results);
                }
              }
            })
        }

        const fileSize   = file.size;
        const { chunkSize } = data;
        let offset     = 0;

        const readEventHandler = function(e) {
          if (e.target.error === null) {
            const done = offset >= file.size;
            offset += e.target.result.byteLength;
            uploadChunk(e.target.result, done, offset);
            if (!done) {
              setTimeout(() => chunkReaderBlock(offset, chunkSize, file, readEventHandler), 100);
            }
          } else {
            console.log("Read error: " + e.target.error);
            return;
          }
        }

        chunkReaderBlock(offset, chunkSize, file, readEventHandler);
      })
    })
  }
}

// TODO: split formData and fileData
let serializeForm = (form, fileUploadData) => {
  const formData = new FormData(form)
  const fileData = [];
  let toRemove = []
  let readerCount = 0

  formData.forEach((val, key) => {
    if (val instanceof File) {
      toRemove.push(key);
      const fileWithMeta = {path: key};
      if (val.size > 0) {
        fileWithMeta.name = val.name;
        fileWithMeta.type = val.type;
        fileWithMeta.size = val.size;

        if (fileUploadData) {
          fileWithMeta.file_ref = fileUploadData[key]["file_ref"];
          fileWithMeta.topic = fileUploadData[key]["topic"];
        }
        fileData.push(fileWithMeta);
      }
    }
  })

  toRemove.forEach((key) => {
    formData.delete(key);
  });

  let params = new URLSearchParams()
  for(let [key, val] of formData.entries()){ params.append(key, val) }

  return {
    formData: params.toString(),
    fileData: fileData.length > 0 ? fileData : null
  };
}

let recursiveMerge = (target, source) => {
  for(let key in source){
    let val = source[key]
    let targetVal = target[key]
    if(isObject(val) && isObject(targetVal)){
      if(targetVal.dynamics && !val.dynamics){ delete targetVal.dynamics}
      recursiveMerge(targetVal, val)
    } else {
      target[key] = val
    }
  }
}

let Session = {
  get(el){ return el.getAttribute(PHX_SESSION) },

  isEqual(el1, el2){ return this.get(el1) === this.get(el2) }
}


export let Rendered = {
  mergeDiff(source, diff){
    if(this.isNewFingerprint(diff)){
      return diff
    } else {
      recursiveMerge(source, diff)
      return source
    }
  },

  isNewFingerprint(diff = {}){ return !!diff.static },

  toString(rendered){
    let output = {buffer: ""}
    this.toOutputBuffer(rendered, output)
    return output.buffer
  },

  toOutputBuffer(rendered, output){
    if(rendered.dynamics){ return this.comprehensionToBuffer(rendered, output) }
    let {static: statics} = rendered

    output.buffer += statics[0]
    for(let i = 1; i < statics.length; i++){
      this.dynamicToBuffer(rendered[i - 1], output)
      output.buffer += statics[i]
    }
  },

  comprehensionToBuffer(rendered, output){
    let {dynamics: dynamics, static: statics} = rendered

    for(let d = 0; d < dynamics.length; d++){
      let dynamic = dynamics[d]
      output.buffer += statics[0]
      for(let i = 1; i < statics.length; i++){
        this.dynamicToBuffer(dynamic[i - 1], output)
        output.buffer += statics[i]
      }
    }
  },

  dynamicToBuffer(rendered, output){
    if(isObject(rendered)){
      this.toOutputBuffer(rendered, output)
    } else {
      output.buffer += rendered
    }
  }
}

function writeBinaryString(view, string, offset) {
  let i = 0;
  for (i; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i))
  }
  return offset + i;
}

function binaryEncode(message , cb) {
  const { join_ref, ref, topic, payload: { file } } = message
  const headerLength = 2
  const metaLength = 3 + join_ref.length + ref.length + topic.length
  const fileLength = file.byteLength
  const header = new ArrayBuffer(headerLength + metaLength)


  const view = new DataView(header)
  view.setUint8(0, 0)
  view.setUint8(1, 1)
  view.setUint8(2, join_ref.length)
  view.setUint8(3, ref.length)
  view.setUint8(4, topic.length)
  let offset = writeBinaryString(view, join_ref, 5)
  offset = writeBinaryString(view, ref, offset)
  offset = writeBinaryString(view, topic, offset)

  var combined = new Uint8Array(header.byteLength + fileLength)
  combined.set(new Uint8Array(header), 0)
  combined.set(new Uint8Array(file), header.byteLength)

  cb(combined.buffer)
}


// todo document LiveSocket specific options like viewLogger
export class LiveSocket {
  constructor(url, opts = {}){
    this.unloaded = false
    this.socket = new Socket(url, opts)
    this.bindingPrefix = opts.bindingPrefix || BINDING_PREFIX
    this.opts = opts
    this.views = {}
    this.params = closure(opts.params || {})
    this.viewLogger = opts.viewLogger
    this.activeElement = null
    this.prevActive = null
    this.prevInput = null
    this.prevValue = null
    this.silenced = false
    this.root = null
    this.linkRef = 0
    this.href = window.location.href
    this.pendingLink = null
    this.currentLocation = clone(window.location)
    this.hooks = opts.hooks || {}

    this.socket.onOpen(() => {
      if(this.isUnloaded()){
        this.destroyAllViews()
        this.joinRootViews()
      }
      this.unloaded = false
    })
    window.addEventListener("beforeunload", e => {
      this.unloaded = true
    })
    const encode = this.socket.encode
    this.socket.encode = function(message, cb) {
      if (message.event === "file") {
        binaryEncode(message, cb)
      } else {
        encode(message, cb)
      }
    }
    this.bindTopLevelEvents()
  }

  getSocket(){ return this.socket }

  log(view, kind, msgCallback){
    if(this.viewLogger){
      let [msg, obj] = msgCallback()
      this.viewLogger(view, kind, msg, obj)
    }
  }

  connect(){
    if(["complete", "loaded","interactive"].indexOf(document.readyState) >= 0){
      this.joinRootViews()
    } else {
      document.addEventListener("DOMContentLoaded", () => {
        this.joinRootViews()
      })
    }
    return this.socket.connect()
  }

  disconnect(){ this.socket.disconnect() }

  // private

  getHookCallbacks(hookName){ return this.hooks[hookName] }

  isUnloaded(){ return this.unloaded }

  getBindingPrefix(){ return this.bindingPrefix }

  binding(kind){ return `${this.getBindingPrefix()}${kind}` }

  channel(topic, params){ return this.socket.channel(topic, params) }

  joinRootViews(){
    Browser.all(document, `${PHX_VIEW_SELECTOR}:not([${PHX_PARENT_ID}])`, rootEl => {
      let view = this.joinView(rootEl, null, this.getHref())
      this.root = this.root || view
    })
  }

  replaceRoot(href, callback = null, linkRef = this.setPendingLink(href)){
    this.root.showLoader(LOADER_TIMEOUT)
    let rootEl = this.root.el
    let rootID = this.root.id
    let wasLoading = this.root.isLoading()

    Browser.fetchPage(href, (status, html) => {
      if(status !== 200){ return Browser.redirect(href) }

      let div = document.createElement("div")
      div.innerHTML = html
      this.joinView(div.firstChild, null, href, newRoot => {
        if(!this.commitPendingLink(linkRef)){
          newRoot.destroy()
          return
        }
        callback && callback()
        this.destroyViewById(rootID)
        rootEl.replaceWith(newRoot.el)
        this.root = newRoot
        if(wasLoading){ this.root.showLoader() }
      })
    })
  }

  joinView(el, parentView, href, callback){
    if(this.getViewById(el.id)){ return }

    let view = new View(el, this, parentView, href)
    this.views[view.id] = view
    view.join(callback)
    return view
  }

  owner(childEl, callback){
    let view = this.getViewById(maybe(childEl.closest(PHX_VIEW_SELECTOR), "id"))
    if(view){ callback(view) }
  }

  getViewById(id){ return this.views[id] }

  onViewError(view){
    this.dropActiveElement(view)
  }

  destroyAllViews(){
    for(let id in this.views){ this.destroyViewById(id) }
  }

  destroyViewById(id){
    let view = this.views[id]
    if(view){
      delete this.views[view.id]
      if(this.root && view.id === this.root.id){ this.root = null }
      view.destroy()
    }
  }

  setActiveElement(target){
    if(this.activeElement === target){ return }
    this.activeElement = target
    let cancel = () => {
      if(target === this.activeElement){ this.activeElement = null }
      target.removeEventListener("mouseup", this)
      target.removeEventListener("touchend", this)
    }
    target.addEventListener("mouseup", cancel)
    target.addEventListener("touchend", cancel)
  }

  getActiveElement(){
    if(document.activeElement === document.body){
      return this.activeElement || document.activeElement
    } else {
      return document.activeElement
    }
  }

  dropActiveElement(view){
    if(this.prevActive && view.ownsElement(this.prevActive)){
      this.prevActive = null
    }
  }

  restorePreviouslyActiveFocus(){
    if(this.prevActive && this.prevActive !== document.body){
      this.prevActive.focus()
    }
  }

  blurActiveElement(){
    this.prevActive = this.getActiveElement()
    if(this.prevActive !== document.body){ this.prevActive.blur() }
  }

  bindTopLevelEvents(){
    this.bindClicks()
    this.bindNav()
    this.bindForms()
    this.bindTargetable({keyup: "keyup", keydown: "keydown"}, (e, type, view, target, phxEvent, phxTarget) => {
      view.pushKey(target, type, e, phxEvent)
    })
    this.bindTargetable({blur: "focusout", focus: "focusin"}, (e, type, view, targetEl, phxEvent, phxTarget) => {
      if(!phxTarget){
        view.pushEvent(type, targetEl, phxEvent)
      }
    })
    this.bindTargetable({blur: "blur", focus: "focus"}, (e, type, view, targetEl, phxEvent, phxTarget) => {
      // blur and focus are triggered on document and window. Discard one to avoid dups
      if(phxTarget && !phxTarget !== "window"){
        view.pushEvent(type, targetEl, phxEvent)
      }
    })

  }

  setPendingLink(href){
    this.linkRef++
    let ref = this.linkRef
    this.pendingLink = href
    return this.linkRef
  }

  commitPendingLink(linkRef){
    if(this.linkRef !== linkRef){
      return false
    } else {
      this.href = this.pendingLink
      this.pendingLink = null
      return true
    }
  }

  getHref(){ return this.href }

  hasPendingLink(){ return !!this.pendingLink }

  bindTargetable(events, callback){
    for(let event in events){
      let browserEventName = events[event]

      this.on(browserEventName, e => {
        let binding = this.binding(event)
        let bindTarget = this.binding("target")
        let targetPhxEvent = e.target.getAttribute && e.target.getAttribute(binding)
        if(targetPhxEvent && !e.target.getAttribute(bindTarget)){
          this.owner(e.target, view => callback(e, event, view, e.target, targetPhxEvent, null))
        } else {
          Browser.all(document, `[${binding}][${bindTarget}=window]`, el => {
            let phxEvent = el.getAttribute(binding)
            this.owner(el, view => callback(e, event, view, el, phxEvent, "window"))
          })
        }
      })
    }
  }

  bindClicks(){
    window.addEventListener("click", e => {
      let click = this.binding("click")
      let target = closestPhxBinding(e.target, click)
      let phxEvent = target && target.getAttribute(click)
      if(!phxEvent){ return }
      e.preventDefault()
      this.owner(target, view => view.pushEvent("click", target, phxEvent))
    }, false)
  }

  bindNav(){
    if(!Browser.canPushState()){ return }
    window.onpopstate = (event) => {
      if(!this.registerNewLocation(window.location)){ return }

      let href = window.location.href

      if(this.root.isConnected()) {
        this.root.pushInternalLink(href)
      } else {
        this.replaceRoot(href)
      }
    }
    window.addEventListener("click", e => {
      let target = closestPhxBinding(e.target, PHX_LIVE_LINK)
      let phxEvent = target && target.getAttribute(PHX_LIVE_LINK)
      if(!phxEvent){ return }
      let href = target.href
      e.preventDefault()
      this.root.pushInternalLink(href, () => {
        Browser.pushState(phxEvent, {}, href)
        this.registerNewLocation(window.location)
      })
    }, false)
  }

  registerNewLocation(newLocation){
    let {pathname, search} = this.currentLocation
    if(pathname + search === newLocation.pathname + newLocation.search){
      return false
    } else {
      this.currentLocation = clone(newLocation)
      return true
    }
  }

  bindForms(){
    this.on("submit", e => {
      let phxEvent = e.target.getAttribute(this.binding("submit"))
      if(!phxEvent){ return }
      e.preventDefault()
      e.target.disabled = true
      this.owner(e.target, view => view.submitForm(e.target, phxEvent))
    }, false)

    for(let type of ["change", "input"]){
      this.on(type, e => {
        let input = e.target
        let key = input.type === "checkbox" ? "checked" : "value"
        if(this.prevInput === input && this.prevValue === input[key]){ return }

        this.prevInput = input
        this.prevValue = input[key]
        let phxEvent = input.form && input.form.getAttribute(this.binding("change"))
        if(!phxEvent){ return }
        this.owner(input, view => {
          if(DOM.isTextualInput(input)){
            input[PHX_HAS_FOCUSED] = true
          } else {
            this.setActiveElement(input)
          }
          view.pushInput(input, phxEvent)
        })
      }, false)
    }
  }

  silenceEvents(callback){
    this.silenced = true
    callback()
    this.silenced = false
  }

  on(event, callback){
    window.addEventListener(event, e => {
      if(!this.silenced){ callback(e) }
    })
  }
}

export let Browser = {
  all(node, query, callback){
    node.querySelectorAll(query).forEach(callback)
  },

  canPushState(){ return (typeof(history.pushState) !== "undefined") },

  fetchPage(href, callback){
    let req = new XMLHttpRequest()
    req.open("GET", href, true)
    req.timeout = PUSH_TIMEOUT
    req.setRequestHeader("content-type", "text/html")
    req.setRequestHeader("cache-control", "max-age=0, no-cache, no-store, must-revalidate, post-check=0, pre-check=0")
    req.setRequestHeader(LINK_HEADER, "live-link")
    req.onerror = () => callback(400)
    req.ontimeout = () => callback(504)
    req.onreadystatechange = () => {
      if(req.readyState !== 4){ return }
      if(req.getResponseHeader(LINK_HEADER) !== "live-link"){ return callback(400) }
      if(req.status !== 200){ return callback(req.status) }
      callback(200, req.responseText)
    }
    req.send()
  },

  pushState(kind, meta, to){
    if(this.canPushState()){
      if(to !== window.location.href){ history[kind + "State"](meta, "", to) }
    } else {
      this.redirect(to)
    }
  },

  dispatchEvent(target, eventString){
    let event = null
    if(typeof(Event) === "function"){
      event = new Event(eventString)
    } else {
      event = document.createEvent("Event")
      event.initEvent(eventString, true, true)
    }
    target.dispatchEvent(event)
  },

  setCookie(name, value){
    document.cookie = `${name}=${value}`
  },

  getCookie(name){
    return document.cookie.replace(new RegExp(`(?:(?:^|.*;\s*)${name}\s*\=\s*([^;]*).*$)|^.*$`), "$1")
  },

  redirect(toURL, flash){
    if(flash){ Browser.setCookie("__phoenix_flash__", flash + "; max-age=60000; path=/") }
    window.location = toURL
  }
}

let DOM = {

  disableForm(form, prefix){
    let disableWith = `${prefix}${PHX_DISABLE_WITH}`
    form.classList.add(PHX_LOADING_CLASS)
    Browser.all(form, `[${disableWith}]`, el => {
      let value = el.getAttribute(disableWith)
      el.setAttribute(`${disableWith}-restore`, el.innerText)
      el.innerText = value
    })
    Browser.all(form, "button", button => {
      button.setAttribute(PHX_DISABLED, button.disabled)
      button.disabled = true
    })
    Browser.all(form, "input", input => {
      input.setAttribute(PHX_READONLY, input.readOnly)
      input.readOnly = true
    })
  },

  restoreDisabledForm(form, prefix){
    let disableWith = `${prefix}${PHX_DISABLE_WITH}`
    form.classList.remove(PHX_LOADING_CLASS)

    Browser.all(form, `[${disableWith}]`, el => {
      let value = el.getAttribute(`${disableWith}-restore`)
      if(value){
        if(el.nodeName === "INPUT") {
          el.value = value
        } else {
          el.innerText = value
        }
        el.removeAttribute(`${disableWith}-restore`)
      }
    })
    Browser.all(form, "button", button => {
      let prev = button.getAttribute(PHX_DISABLED)
      if(prev){
        button.disabled = prev === "true"
        button.removeAttribute(PHX_DISABLED)
      }
    })
    Browser.all(form, "input", input => {
      let prev = input.getAttribute(PHX_READONLY)
      if(prev){
        input.readOnly = prev === "true"
        input.removeAttribute(PHX_READONLY)
      }
    })
  },

  discardError(el){
    let field = el.getAttribute && el.getAttribute(PHX_ERROR_FOR)
    if(!field) { return }
    let input = document.getElementById(field)

    if(field && !(input[PHX_HAS_FOCUSED] || input.form[PHX_HAS_SUBMITTED])){
      el.style.display = "none"
    }
  },

  isPhxChild(node){
    return node.getAttribute && node.getAttribute(PHX_PARENT_ID)
  },

  applyPhxUpdate(fromEl, toEl, phxUpdate){
    let type = toEl.getAttribute && toEl.getAttribute(phxUpdate)
    if(!type || type === "replace"){
      return false
    } else {
      DOM.mergeAttrs(fromEl, toEl)
    }

    switch(type){
      case "ignore": break
      case "append":
        fromEl.innerHTML += toEl.innerHTML
        break
      case "prepend":
        fromEl.innerHTML = toEl.innerHTML + fromEl.innerHTML
        break
      default: throw new Error(`unsupported phx-update "${type}"`)
    }
    return true
  },

  patch(view, container, id, html){
    let changes = {added: [], updated: [], discarded: []}
    let focused = view.liveSocket.getActiveElement()
    let selectionStart = null
    let selectionEnd = null
    let phxUpdate = view.liveSocket.binding(PHX_UPDATE)
    let containerTagName = container.tagName.toLowerCase()

    if(DOM.isTextualInput(focused)){
      selectionStart = focused.selectionStart
      selectionEnd = focused.selectionEnd
    }

    morphdom(container, `<${containerTagName}>${html}</${containerTagName}>`, {
      childrenOnly: true,
      onBeforeNodeAdded: function(el){
        //input handling
        DOM.discardError(el)
        return el
      },
      onNodeAdded: function(el){
        // nested view handling
        if(DOM.isPhxChild(el) && view.ownsElement(el)){
          view.onNewChildAdded()
          return true
        } else {
          changes.added.push(el)
        }
      },
      onBeforeNodeDiscarded: function(el){
        // nested view handling
        if(DOM.isPhxChild(el)){
          view.liveSocket.destroyViewById(el.id)
          return true
        }
        changes.discarded.push(el)
      },
      onBeforeElUpdated: function(fromEl, toEl) {
        if(fromEl.isEqualNode(toEl)){ return false } // Skip subtree if both elems and children are equal

        if(DOM.applyPhxUpdate(fromEl, toEl, phxUpdate)){
          changes.updated.push({fromEl, toEl: fromEl})
          return false
        }


        // file upload
        if (fromEl.nodeName === "INPUT" && toEl.nodeName === "INPUT" && fromEl.type === "file") {
          return false;
        }
        // nested view handling
        if(DOM.isPhxChild(toEl)){
          let prevStatic = fromEl.getAttribute(PHX_STATIC)

          if(!Session.isEqual(toEl, fromEl)){
            view.liveSocket.destroyViewById(fromEl.id)
            view.onNewChildAdded()
          }
          DOM.mergeAttrs(fromEl, toEl)
          fromEl.setAttribute(PHX_STATIC, prevStatic)
          return false
        }

        // input handling
        if(fromEl.getAttribute && fromEl[PHX_HAS_SUBMITTED]){
          toEl[PHX_HAS_SUBMITTED] = true
        }
        if(fromEl[PHX_HAS_FOCUSED]){
          toEl[PHX_HAS_FOCUSED] = true
        }
        DOM.discardError(toEl)

        if(DOM.isTextualInput(fromEl) && fromEl === focused){
          DOM.mergeInputs(fromEl, toEl)
          changes.updated.push({fromEl, toEl: fromEl})
          return false
        } else {
          changes.updated.push({fromEl, toEl})
          return true
        }
      }
    })

    view.liveSocket.silenceEvents(() => {
      DOM.restoreFocus(focused, selectionStart, selectionEnd)
    })
    Browser.dispatchEvent(document, "phx:update")
    return changes
  },

  mergeAttrs(target, source){
    var attrs = source.attributes
    for (let i = 0, length = attrs.length; i < length; i++){
      let name = attrs[i].name
      let value = source.getAttribute(name)
      target.setAttribute(name, value)
    }
  },

  mergeInputs(target, source){
    DOM.mergeAttrs(target, source)
    target.readOnly = source.readOnly
  },

  restoreFocus(focused, selectionStart, selectionEnd){
    if(!DOM.isTextualInput(focused)){ return }
    if(focused.value === "" || focused.readOnly){ focused.blur()}
    focused.focus()
    if(focused.setSelectionRange && focused.type === "text" || focused.type === "textarea"){
      focused.setSelectionRange(selectionStart, selectionEnd)
    }
  },

  isTextualInput(el){
    return FOCUSABLE_INPUTS.indexOf(el.type) >= 0
  }
}

export class View {
  constructor(el, liveSocket, parentView, href){
    this.liveSocket = liveSocket
    this.parent = parentView
    this.newChildrenAdded = false
    this.gracefullyClosed = false
    this.el = el
    this.id = this.el.id
    this.view = this.el.getAttribute(PHX_VIEW)
    this.loaderTimer = null
    this.pendingDiffs = []
    this.href = href
    this.joinedOnce = false
    this.viewHooks = {}
    this.channel = this.liveSocket.channel(`lv:${this.id}`, () => {
      return {
        url: this.href || this.liveSocket.root.href,
        params: this.liveSocket.params(this.view),
        session: this.getSession(),
        static: this.getStatic()
      }
    })

    this.loaderTimer = setTimeout(() => this.showLoader(), LOADER_TIMEOUT)
    this.bindChannel()
  }

  isConnected(){ return this.channel.canPush() }

  getSession(){ return Session.get(this.el) }

  getStatic(){
    let val = this.el.getAttribute(PHX_STATIC)
    return val === "" ? null : val
  }

  destroy(callback = function(){}){
    clearTimeout(this.loaderTimer)
    let onFinished = () => {
      callback()
      for(let id in this.viewHooks){ this.destroyHook(this.viewHooks[id]) }
    }
    if(this.hasGracefullyClosed()){
      this.log("destroyed", () => ["the server view has gracefully closed"])
      onFinished()
    } else {
      this.log("destroyed", () => ["the child has been removed from the parent"])
      this.channel.leave()
        .receive("ok", onFinished)
        .receive("error", onFinished)
        .receive("timeout", onFinished)
    }
  }

  setContainerClasses(...classes){
    this.el.classList.remove(
      PHX_CONNECTED_CLASS,
      PHX_DISCONNECTED_CLASS,
      PHX_ERROR_CLASS
    )
    this.el.classList.add(...classes)
  }

  isLoading(){ return this.el.classList.contains(PHX_DISCONNECTED_CLASS)}

  showLoader(timeout){
    clearTimeout(this.loaderTimer)
    if(timeout){
      this.loaderTimer = setTimeout(() => this.showLoader(), timeout)
    } else {
      for(let id in this.viewHooks){ this.viewHooks[id].__trigger__("disconnected") }
      this.setContainerClasses(PHX_DISCONNECTED_CLASS)
    }
  }

  hideLoader(){
    clearTimeout(this.loaderTimer)
    for(let id in this.viewHooks){ this.viewHooks[id].__trigger__("reconnected") }
    this.setContainerClasses(PHX_CONNECTED_CLASS)
  }

  log(kind, msgCallback){
    this.liveSocket.log(this, kind, msgCallback)
  }

  onJoin({rendered, live_redirect}){
    this.log("join", () => ["", JSON.stringify(rendered)])
    this.rendered = rendered
    this.hideLoader()
    let changes = DOM.patch(this, this.el, this.id, Rendered.toString(this.rendered))
    changes.added.push(this.el)
    Browser.all(this.el, `[${this.binding(PHX_HOOK)}]`, hookEl => changes.added.push(hookEl))
    this.triggerHooks(changes)
    this.joinNewChildren()
    if(live_redirect){
      let {kind, to} = live_redirect
      Browser.pushState(kind, {}, to)
    }
  }

  joinNewChildren(){
    Browser.all(document, `${PHX_VIEW_SELECTOR}[${PHX_PARENT_ID}="${this.id}"]`, el => {
      let child = this.liveSocket.getViewById(el.id)
      if(!child){
        this.liveSocket.joinView(el, this)
      }
    })
  }

  update(diff){
    if(isEmpty(diff)){ return }
    if(this.liveSocket.hasPendingLink()){ return this.pendingDiffs.push(diff) }

    this.log("update", () => ["", JSON.stringify(diff)])
    this.rendered = Rendered.mergeDiff(this.rendered, diff)
    let html = Rendered.toString(this.rendered)
    this.newChildrenAdded = false
    this.triggerHooks(DOM.patch(this, this.el, this.id, html))
    if(this.newChildrenAdded){ this.joinNewChildren() }
  }

  getHook(el){ return this.viewHooks[ViewHook.elementID(el)] }

  addHook(el){ if(ViewHook.elementID(el) || !el.getAttribute){ return }
    let callbacks = this.liveSocket.getHookCallbacks(el.getAttribute(this.binding(PHX_HOOK)))
    if(callbacks && this.ownsElement(el)){
      let hook = new ViewHook(this, el, callbacks)
      this.viewHooks[ViewHook.elementID(hook.el)] = hook
      hook.__trigger__("mounted")
    }
  }

  destroyHook(hook){
    hook.__trigger__("destroyed")
    delete this.viewHooks[ViewHook.elementID(hook.el)]
  }

  triggerHooks(changes){
    changes.updated.push({fromEl: this.el, toEl: this.el})
    changes.added.forEach(el => this.addHook(el))
    changes.updated.forEach(({fromEl, toEl}) => {
      let hook = this.getHook(fromEl)
      let phxAttr = this.binding(PHX_HOOK)
      if(hook && toEl.getAttribute && fromEl.getAttribute(phxAttr) === toEl.getAttribute(phxAttr)){
        hook.__trigger__("updated")
      } else if(hook){
        this.destroyHook(hook)
        this.addHook(fromEl)
      }
    })
    changes.discarded.forEach(el => {
      let hook = this.getHook(el)
      hook && this.destroyHook(hook)
    })
  }

  applyPendingUpdates(){
    this.pendingDiffs.forEach(diff => this.update(diff))
    this.pendingDiffs = []
  }

  onNewChildAdded(){
    this.newChildrenAdded = true
  }

  bindChannel(){
    this.channel.on("diff", (diff) => this.update(diff))
    this.channel.on("redirect", ({to, flash}) => this.onRedirect({to, flash}))
    this.channel.on("live_redirect", ({to, kind}) => this.onLiveRedirect({to, kind}))
    this.channel.on("external_live_redirect", ({to, kind}) => this.onExternalLiveRedirect({to, kind}))
    this.channel.on("session", ({token}) => this.el.setAttribute(PHX_SESSION, token))
    this.channel.onError(reason => this.onError(reason))
    this.channel.onClose(() => this.onGracefulClose())
  }

  onGracefulClose(){
    this.gracefullyClosed = true
    this.liveSocket.destroyViewById(this.id)
  }

  onExternalLiveRedirect({to, kind}){
    this.liveSocket.replaceRoot(to, () => Browser.pushState(kind, {}, to))
  }

  onLiveRedirect({to, kind}){
    Browser.pushState(kind, {}, to)
  }

  onRedirect({to, flash}){ Browser.redirect(to, flash) }

  hasGracefullyClosed(){ return this.gracefullyClosed }

  join(callback){
    if(this.parent){
      this.parent.channel.onClose(() => this.onGracefulClose())
      this.parent.channel.onError(() => this.liveSocket.destroyViewById(this.id))
    }
    this.channel.join()
      .receive("ok", data => {
        if(!this.joinedOnce){ callback && callback(this) }
        this.joinedOnce = true
        this.onJoin(data)
      })
      .receive("error", resp => this.onJoinError(resp))
      .receive("timeout", () => this.onJoinError("timeout"))
  }

  onJoinError(resp){
    if(resp.redirect){ return this.onRedirect(resp.redirect) }
    if(resp.external_live_redirect){ return this.onExternalLiveRedirect(resp.external_live_redirect) }
    this.displayError()
    this.log("error", () => ["unable to join", resp])
  }

  onError(reason){
    this.log("error", () => ["view crashed", reason])
    this.liveSocket.onViewError(this)
    document.activeElement.blur()
    if(this.liveSocket.isUnloaded()){
      this.showLoader(BEFORE_UNLOAD_LOADER_TIMEOUT)
    } else {
      this.displayError()
    }
  }

  displayError(){
    this.showLoader()
    this.setContainerClasses(PHX_DISCONNECTED_CLASS, PHX_ERROR_CLASS)
  }

  pushWithReply(event, payload, onReply = function(){ }){
    return(
      this.channel.push(event, payload, PUSH_TIMEOUT).receive("ok", resp => {
        if(resp.diff){ this.update(resp.diff) }
        if(resp.redirect){ this.onRedirect(resp.redirect) }
        if(resp.live_redirect){ this.onLiveRedirect(resp.live_redirect) }
        if(resp.external_live_redirect){ this.onExternalLiveRedirect(resp.external_live_redirect) }
        onReply(resp)
      })
    )
  }

  pushEvent(type, el, phxEvent){
    let val = el.getAttribute(this.binding("value")) || el.value || ""
    this.pushWithReply("event", {
      type: type,
      event: phxEvent,
      value: val
    })
  }

  pushKey(keyElement, kind, event, phxEvent){
    this.pushWithReply("event", {
      type: kind,
      event: phxEvent,
      value: keyElement.value || event.key
    })
  }

  pushInput(inputEl, phxEvent){
    const { fileData, formData } = serializeForm(inputEl.form);
    const event = { type: "form", event: phxEvent, value: formData };
    if (!fileData) {
      this.pushWithReply("event", event);
      return;
    }
    this.pushWithReply("event", Object.assign({}, event, {file_data: fileData}));
  }

  pushFormSubmit(formEl, phxEvent, onReply){
    this.uploadCount = 0;
    let files = gatherFiles(formEl)
    let numFiles = Object.keys(files).length;
    if (numFiles > 0) {
      uploadFiles(this, files, (uploads) => {
        const { formData, fileData} = serializeForm(formEl, uploads);
            this.pushWithReply("event", {
              type: "form",
              file_count: numFiles,
              // file_data: ...
              event: phxEvent,
              value: formData,
              file_data: fileData
            }, onReply)
          })
    } else {
      this.pushWithReply("event", {
        type: "form",
        event: phxEvent,
        value: serializeForm(formEl)
      }, onReply)
    }
  }

  pushInternalLink(href, callback){
    if(!this.isLoading()){ this.showLoader(LOADER_TIMEOUT) }
    let linkRef = this.liveSocket.setPendingLink(href)
    this.pushWithReply("link", {url: href}, resp => {
      if(resp.link_redirect){
        this.liveSocket.replaceRoot(href, callback, linkRef)
      } else if(this.liveSocket.commitPendingLink(linkRef)){
        this.href = href
        this.applyPendingUpdates()
        this.hideLoader()
        callback && callback()
      }
    }).receive("timeout", () => Browser.redirect(window.location.href))
  }

  ownsElement(element){
    return element.getAttribute(PHX_PARENT_ID) === this.id ||
           maybe(element.closest(PHX_VIEW_SELECTOR), "id") === this.id
  }

  submitForm(form, phxEvent){
    let prefix = this.liveSocket.getBindingPrefix()
    form[PHX_HAS_SUBMITTED] = "true"
    DOM.disableForm(form, prefix)
    this.liveSocket.blurActiveElement(this)
    this.pushFormSubmit(form, phxEvent, () => {
      DOM.restoreDisabledForm(form, prefix)
      this.liveSocket.restorePreviouslyActiveFocus()
    })
  }

  binding(kind){ return this.liveSocket.binding(kind)}
}

let viewHookID = 1
class ViewHook {
  static makeID(){ return viewHookID++ }
  static elementID(el){ return el.phxHookId }

  constructor(view, el, callbacks){
    this.__view = view
    this.__callbacks = callbacks
    this.el = el
    this.viewName = view.view
    this.el.phxHookId = this.constructor.makeID()
    for(let key in this.__callbacks){ this[key] = this.__callbacks[key] }
  }

  pushEvent(event, payload){
    this.__view.pushWithReply("event", {type: "hook", event: event, value: payload})
  }
  __trigger__(kind){
    let callback = this.__callbacks[kind]
    callback && callback.call(this)
  }
}

export default LiveSocket

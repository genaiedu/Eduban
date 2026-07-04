/**
 * Polyfill for HTML5 drag and drop on touch devices.
 * (c) 2016-2023 Bernardo Castilho
 */
var DragDropTouch;
(function (DragDropTouch_1) {
    'use strict';
    var DataTransfer = (function () {
        function DataTransfer() {
            this._dropEffect = 'move';
            this._effectAllowed = 'all';
            this._data = {};
        }
        Object.defineProperty(DataTransfer.prototype, "dropEffect", {
            get: function () { return this._dropEffect; },
            set: function (value) { this._dropEffect = value; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(DataTransfer.prototype, "effectAllowed", {
            get: function () { return this._effectAllowed; },
            set: function (value) { this._effectAllowed = value; },
            enumerable: true,
            configurable: true
        });
        Object.defineProperty(DataTransfer.prototype, "types", {
            get: function () { return Object.keys(this._data); },
            enumerable: true,
            configurable: true
        });
        DataTransfer.prototype.clearData = function (type) {
            if (type !== null) {
                delete this._data[type.toLowerCase()];
            }
            else {
                this._data = {};
            }
        };
        DataTransfer.prototype.getData = function (type) {
            return this._data[type.toLowerCase()] || '';
        };
        DataTransfer.prototype.setData = function (type, value) {
            this._data[type.toLowerCase()] = value;
        };
        DataTransfer.prototype.setDragImage = function (img, x, y) {
            var ds = DragDropTouch._instance;
            ds._imgCustom = img;
            ds._imgOffset = { x: x, y: y };
        };
        return DataTransfer;
    }());
    DragDropTouch_1.DataTransfer = DataTransfer;
    var DragDropTouch = (function () {
        function DragDropTouch() {
            this._lastClick = 0;
            if (DragDropTouch._instance) {
                throw 'DragDropTouch instance already created.';
            }
            if ('ontouchstart' in document) {
                var d = document, ts = this._touchstart.bind(this), tm = this._touchmove.bind(this), te = this._touchend.bind(this), tc = this._touchcancel.bind(this);
                d.addEventListener('touchstart', ts, { passive: false });
                d.addEventListener('touchmove', tm, { passive: false });
                d.addEventListener('touchend', te);
                d.addEventListener('touchcancel', tc);
                d.addEventListener('click', this._click.bind(this));
            }
        }
        DragDropTouch.getInstance = function () {
            return DragDropTouch._instance;
        };
        DragDropTouch.prototype._touchstart = function (e) {
            var _this = this;
            if (this._shouldHandle(e)) {
                if (Date.now() - this._lastClick < DragDropTouch._DBLCLICK) {
                    if (this._dispatchEvent(e, 'dblclick', e.target)) {
                        e.preventDefault();
                        this._reset();
                        return;
                    }
                }
                this._reset();
                var src = this._closestDraggable(e.target);
                if (src) {
                    if (!this._dispatchEvent(e, 'mousemove', e.target) &&
                        !this._dispatchEvent(e, 'mousedown', e.target)) {
                        this._dragSource = src;
                        this._ptDown = this._getPoint(e);
                        this._lastTouch = e;
                        e.preventDefault();
                        setTimeout(function () {
                            if (_this._dragSource === src && _this._dataTransfer === null) {
                                if (_this._dispatchEvent(e, 'dragstart', src)) {
                                    _this._dataTransfer = new DataTransfer();
                                }
                            }
                        }, DragDropTouch._DRAGDELAY);
                    }
                }
            }
        };
        DragDropTouch.prototype._touchmove = function (e) {
            if (this._shouldHandle(e)) {
                var target = this._getTarget(e);
                if (this._dataTransfer) {
                    this._lastTouch = e;
                    this._dispatchEvent(e, 'drag', this._dragSource);
                    this._dispatchEvent(e, 'dragover', target);
                    e.preventDefault();
                }
                else if (this._dragSource) {
                    var pt = this._getPoint(e);
                    var dx = pt.x - this._ptDown.x;
                    var dy = pt.y - this._ptDown.y;
                    if (dx * dx + dy * dy > DragDropTouch._THRESHOLD * DragDropTouch._THRESHOLD) {
                        this._reset();
                    }
                }
            }
        };
        DragDropTouch.prototype._touchend = function (e) {
            if (this._shouldHandle(e)) {
                if (this._dataTransfer) {
                    var target = this._getTarget(this._lastTouch);
                    this._dispatchEvent(this._lastTouch, 'drop', target);
                    this._dispatchEvent(this._lastTouch, 'dragend', this._dragSource);
                    this._reset();
                    e.preventDefault();
                }
                else if (this._dragSource) {
                    this._dispatchEvent(this._lastTouch, 'mouseup', e.target);
                    this._lastClick = Date.now();
                    this._reset();
                }
            }
        };
        DragDropTouch.prototype._touchcancel = function (e) {
            if (this._shouldHandle(e)) {
                this._reset();
            }
        };
        DragDropTouch.prototype._click = function (e) {
            if (this._shouldHandle(e)) {
                if (this._dataTransfer) {
                    e.stopPropagation();
                    e.preventDefault();
                }
            }
        };
        DragDropTouch.prototype._reset = function () {
            this._dragSource = null;
            this._ptDown = null;
            this._lastTouch = null;
            this._dataTransfer = null;
        };
        DragDropTouch.prototype._shouldHandle = function (e) {
            return e && !e.defaultPrevented && e.touches && e.touches.length < 2;
        };
        DragDropTouch.prototype._dispatchEvent = function (e, type, target) {
            if (e && target) {
                var evt = document.createEvent('Event'), t = e.touches ? e.touches[0] : e;
                evt.initEvent(type, true, true);
                evt.button = 0;
                evt.which = 1;
                evt.buttons = 1;
                evt.pageX = t.pageX;
                evt.pageY = t.pageY;
                evt.clientX = t.clientX;
                evt.clientY = t.clientY;
                evt.screenX = t.screenX;
                evt.screenY = t.screenY;
                evt.dataTransfer = this._dataTransfer;
                target.dispatchEvent(evt);
                return evt.defaultPrevented;
            }
            return false;
        };
        DragDropTouch.prototype._closestDraggable = function (e) {
            for (; e; e = e.parentElement) {
                if (e.hasAttribute('draggable') && e.draggable) {
                    return e;
                }
            }
            return null;
        };
        DragDropTouch.prototype._getPoint = function (e, page) {
            var t = e.touches ? e.touches[0] : e;
            return { x: page ? t.pageX : t.clientX, y: page ? t.pageY : t.clientY };
        };
        DragDropTouch.prototype._getTarget = function (e) {
            var pt = this._getPoint(e), el = document.elementFromPoint(pt.x, pt.y);
            while (el && getComputedStyle(el).pointerEvents === 'none') {
                el = el.parentElement;
            }
            return el;
        };
        DragDropTouch._instance = new DragDropTouch();
        DragDropTouch._THRESHOLD = 5;
        DragDropTouch._DRAGDELAY = 150;
        DragDropTouch._DBLCLICK = 500;
        return DragDropTouch;
    }());
    DragDropTouch_1.DragDropTouch = DragDropTouch;
})(DragDropTouch || (DragDropTouch = {}));

var myWindowId; // Current Windows ID
    
// content-script.js

var myPort = browser.runtime.connect({name:"port-hackbar"});
myPort.postMessage({msg: "Connecting..."});

myPort.onMessage.addListener(function(m) {
  console.log("Panel receive: ");
  console.log(m.msg);
});


// myPort.postMessage({msg: "My Message To background"});


// Insert text at the current cursor position (or replace the selection) of a textarea/input
function insertAtCursor(el, text) {
    el.focus();
    var start = el.selectionStart;
    var end = el.selectionEnd;
    var value = el.value;
    el.value = value.slice(0, start) + text + value.slice(end);
    var pos = start + text.length;
    el.selectionStart = el.selectionEnd = pos;
}


/************************************************/
/* REPLACE: increment/decrement selected values  */
/************************************************/

function incInt(s, delta) {
    var neg = /^-/.test(s);
    var digits = neg ? s.slice(1) : s;
    if (!/^[0-9]+$/.test(digits)) return s;
    var n = parseInt(s, 10) + delta;
    var out = Math.abs(n).toString();
    while (out.length < digits.length) out = '0' + out;
    return (n < 0 ? '-' : '') + out;
}

function incHex(s, delta) {
    var m = s.match(/^(0[xX])?([0-9a-fA-F]+)$/);
    if (!m) return s;
    var prefix = m[1] || '';
    var hexDigits = m[2];
    var upper = /[A-F]/.test(hexDigits) && !/[a-f]/.test(hexDigits);
    var n = Math.max(0, parseInt(hexDigits, 16) + delta);
    var out = n.toString(16);
    while (out.length < hexDigits.length) out = '0' + out;
    return prefix + (upper ? out.toUpperCase() : out);
}

function incOct(s, delta) {
    if (!/^[0-7]+$/.test(s)) return s;
    var n = Math.max(0, parseInt(s, 8) + delta);
    var out = n.toString(8);
    while (out.length < s.length) out = '0' + out;
    return out;
}

// Odometer-style increment/decrement over an alphabet. On overflow past the
// leftmost character, a new character is prepended: `carryChar` is the first
// alphabet symbol for a positional numeral system with a zero digit (AlphaNum,
// base36: "z" + 1 = "10"), or `firstChar` itself for a bijective, zero-less
// system (Alpha, like Excel columns: "z" + 1 = "aa", "zz" + 1 = "aaa"). On
// underflow past the leftmost character, clamps to the shortest all-firstChar
// string instead of going negative/empty.
function incOverAlphabet(s, delta, alphabet, firstChar, carryChar) {
    var chars = s.toLowerCase().split('');
    var steps = Math.abs(delta);
    var dir = delta > 0 ? 1 : -1;
    for (var k = 0; k < steps; k++) {
        var i = chars.length - 1;
        while (i >= 0) {
            var idx = alphabet.indexOf(chars[i]) + dir;
            if (idx >= alphabet.length) {
                chars[i] = firstChar;
                i--;
                if (i < 0) chars.unshift(carryChar);
            } else if (idx < 0) {
                chars[i] = alphabet[alphabet.length - 1];
                i--;
                if (i < 0) chars = [firstChar];
            } else {
                chars[i] = alphabet[idx];
                break;
            }
        }
    }
    return chars.join('');
}

function incAlpha(s, delta) {
    if (!/^[a-zA-Z]+$/.test(s)) return s;
    var isUpper = s === s.toUpperCase();
    var out = incOverAlphabet(s, delta, 'abcdefghijklmnopqrstuvwxyz', 'a', 'a');
    return isUpper ? out.toUpperCase() : out;
}

function incAlphaNum(s, delta) {
    if (!/^[a-zA-Z0-9]+$/.test(s)) return s;
    var isUpper = s === s.toUpperCase() && /[A-Z]/.test(s);
    var out = incOverAlphabet(s, delta, '0123456789abcdefghijklmnopqrstuvwxyz', '0', '1');
    return isUpper ? out.toUpperCase() : out;
}

// Increment/decrement the currently selected text in whichever Hackbar field has
// focus, using the format chosen in the toolbar's INT/HEX/OCT/Alpha/AlphaNum select.
function replaceSelectionValue(delta) {
    var el = document.activeElement;
    var fieldIds = ['GETAREA', 'POSTDATA', 'COOKIES', 'REFERER'];
    if (!el || fieldIds.indexOf(el.id) === -1) return;
    var start = el.selectionStart;
    var end = el.selectionEnd;
    if (start === end) return; // nothing selected

    var selected = el.value.slice(start, end);
    var replacement;
    switch ($('#numFormat').val()) {
        case 'INT': replacement = incInt(selected, delta); break;
        case 'HEX': replacement = incHex(selected, delta); break;
        case 'OCT': replacement = incOct(selected, delta); break;
        case 'Alpha': replacement = incAlpha(selected, delta); break;
        case 'AlphaNum': replacement = incAlphaNum(selected, delta); break;
        default: replacement = selected;
    }

    el.value = el.value.slice(0, start) + replacement + el.value.slice(end);
    el.focus();
    el.selectionStart = start;
    el.selectionEnd = start + replacement.length;
}


$( document ).ready(function() {
    
    $(".togglenav").click(function() {
        $(".togglenav").not(this).removeClass("active");
        $(this).toggleClass("active");
    });
    
    $('body').click(function(evt){
       if($(evt.target).closest('.togglenav').length)
            return;
       if($(evt.target).closest('.menu').length)
            return;
       if($(evt.target).closest('.menuitem').length)
            return;
        $(".togglenav").not(this).removeClass("active");
    });
    
    
    $('#checkBoxPost').change(function() {
        if (this.checked) {
            $("#section3").show();
        } else {
            $("#section3").hide();
        }
    });
    $('#checkBoxCookies').change(function() {
        if (this.checked) {
            $("#section4").show();
        } else {
            $("#section4").hide();
        }
    });
    $('#checkBoxReferrer').change(function() {
        if (this.checked) {
            $("#section5").show();
        } else {
            $("#section5").hide();
        }
    });
    
    
    
    /***********/
    /* ACTIONS */
    /***********/


    /***********/
    /* REPLACE */
    /***********/

    // Keep the textarea's selection intact instead of losing it to the button on click
    $("#increment, #decrement").on('mousedown', function(e){
        e.preventDefault();
    });
    $("#increment").click(function(){
        replaceSelectionValue(1);
    });
    $("#decrement").click(function(){
        replaceSelectionValue(-1);
    });


    // "Load URL"
    $("#loadurl").click(function(){
        myPort.postMessage({msg: "they clicked the button!"});
    });



    /*******/
    /* LFI */
    /*******/

    var lfiDepth = 6; // Number of "../" prepended to traversal payloads, adjustable below

    // "../" depth stepper (stopPropagation so clicking it doesn't close the LFI menu)
    $("#lfiDepthUp").click(function(e){
        e.stopPropagation();
        lfiDepth++;
        $("#lfiDepthValue").text(lfiDepth);
    });
    $("#lfiDepthDown").click(function(e){
        e.stopPropagation();
        lfiDepth = Math.max(0, lfiDepth - 1);
        $("#lfiDepthValue").text(lfiDepth);
    });

    // Raw LFI payloads (php://input, php://filter/... wrapper): insert as-is
    $("#LFI .menuitem[data-lfi='raw']").click(function(){
        insertAtCursor($("#GETAREA")[0], $(this).text());
    });

    // "../" traversal payloads: build with the current depth, e.g. "../../../etc/passwd"
    $("#LFI .menuitem[data-lfi='traversal']").click(function(){
        var payload = "../".repeat(lfiDepth) + $(this).data("file");
        insertAtCursor($("#GETAREA")[0], payload);
    });


});

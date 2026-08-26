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

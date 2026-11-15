// First-stage check of error reporting: an uncaught error must reach the log
// with this file's name and the line it was thrown on, and the player must
// exit with code 2.
console.log('about to call a function that does not exist');
function inner() {
  thisFunctionDoesNotExist();
}
inner();

const { handleRequest, handleUnexpectedError } = require("../server");

module.exports = function handler(request, response) {
  handleRequest(request, response).catch((error) => {
    handleUnexpectedError(error, response);
  });
};

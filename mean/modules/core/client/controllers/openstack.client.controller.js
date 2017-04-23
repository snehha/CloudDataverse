(function () {
  'use strict';

  angular
    .module('core')
    .controller('OpenStackController', OpenStackController);

  function OpenStackController($scope, $http) {
    var vm = this;
    vm.User = {};
    vm.User.UserName = '';
    vm.User.Password = '';
    vm.LoginWarning = '';
    vm.WarningFlag = false;

    vm.AuthenticateUser = function () {
      // empty fields, don't post
      if (vm.User.UserName.length === 0 || vm.User.Password.length === 0) {
        vm.LoginWarning = 'Username or Password is missing.';
        vm.WarningFlag = true;
        // focus form field on empty field
        if (!vm.User.UserName.length)
          $('#open-stack-username').focus();
        else
          $('#open-stack-password').focus();
      } else {
          // make post to node auth endpoint
        var req = { user: vm.User.UserName, password: vm.User.Password };
        $http.post('/api/auth', req, function successCallback(res)){
          //.then(function successCallback (res) {
            window.location = '/compute';
          })
          .fail(function errorCallback(res)) {
            //window.location = '/error';
            vm.LoginWarning = 'We couldn\'t authenticate you. Try again.';
            vm.WarningFlag = true;
          });
      }
    };
  }
}());

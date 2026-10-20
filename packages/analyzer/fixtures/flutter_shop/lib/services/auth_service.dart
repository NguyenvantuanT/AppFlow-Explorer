import 'package:flutter/foundation.dart';

class AuthService extends ChangeNotifier {
  bool _signedIn = false;
  bool get isSignedIn => _signedIn;

  Future<void> signIn(String email, String password) async {
    await Future<void>.delayed(const Duration(milliseconds: 400));
    _signedIn = true;
    notifyListeners();
  }

  void signOut() {
    _signedIn = false;
    notifyListeners();
  }
}

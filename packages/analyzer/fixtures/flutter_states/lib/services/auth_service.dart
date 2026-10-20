class AuthService {
  AuthService._();

  static final instance = AuthService._();

  bool isLoggedIn = false;

  Future<void> signIn(String email, String password) async {
    isLoggedIn = true;
  }
}

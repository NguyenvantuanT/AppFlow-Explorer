import 'package:flutter_test/flutter_test.dart';
import 'package:shoplite/main.dart';

void main() {
  testWidgets('app boots', (tester) async {
    await tester.pumpWidget(const ShopLiteApp());
  });
}

#import <React/RCTBridgeModule.h>
#import <React/RCTUtils.h>
#import "RecipeBox-Swift.h"

@interface TimerModule : NSObject <RCTBridgeModule>
@end

@implementation TimerModule

RCT_EXPORT_MODULE(CookingTimer);

RCT_EXPORT_METHOD(start:(nonnull NSNumber *)seconds) {}

RCT_EXPORT_METHOD(openScanner) {
  dispatch_async(dispatch_get_main_queue(), ^{
    ScanViewController *scanner = [ScanViewController new];
    [RCTPresentedViewController() presentViewController:scanner animated:YES completion:nil];
  });
}

@end

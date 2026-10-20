#import <React/RCTBridgeModule.h>

@interface TimerModule : NSObject <RCTBridgeModule>
@end

@implementation TimerModule

RCT_EXPORT_MODULE(CookingTimer);

RCT_EXPORT_METHOD(start:(nonnull NSNumber *)seconds) {}

@end

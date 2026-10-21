#import <React/RCTBridgeModule.h>

@interface RCT_EXTERN_MODULE(LiveManager, NSObject)

RCT_EXTERN_METHOD(startStream: (NSInteger)roomId
                  name: (NSString *)name)

RCT_EXTERN_METHOD(joinStream: (NSInteger)roomId)

@end

#import <UIKit/UIKit.h>

@interface LegacyStatsViewController : UIViewController
@end

@interface StatsDetailViewController : UIViewController
@end

@implementation LegacyStatsViewController

- (IBAction)showDetail:(id)sender {
    StatsDetailViewController *detail = [[StatsDetailViewController alloc] init];
    [self.navigationController pushViewController:detail animated:YES];
}

@end

@implementation StatsDetailViewController
@end

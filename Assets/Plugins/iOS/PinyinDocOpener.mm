#import <UIKit/UIKit.h>

extern "C" UIViewController *UnityGetGLViewController();

extern "C" {

void _PinyinOpenDocument(const char *path)
{
    if (path == NULL) return;
    NSString *p = [NSString stringWithUTF8String:path];
    NSURL *url = [NSURL fileURLWithPath:p];
    if (![[NSFileManager defaultManager] fileExistsAtPath:p]) return;

    UIViewController *root = UnityGetGLViewController();
    UIActivityViewController *controller = [[UIActivityViewController alloc]
        initWithActivityItems:@[url] applicationActivities:nil];
    UIPopoverPresentationController *popover = controller.popoverPresentationController;
    if (popover != nil) {
        popover.sourceView = root.view;
        popover.sourceRect = CGRectMake(root.view.bounds.size.width / 2.0,
                                        root.view.bounds.size.height - 1.0, 1.0, 1.0);
    }
    [root presentViewController:controller animated:YES completion:nil];
}

}


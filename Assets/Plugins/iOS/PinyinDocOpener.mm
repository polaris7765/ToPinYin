#import <UIKit/UIKit.h>

extern "C" UIViewController *UnityGetGLViewController();

// iOS 端“用其它应用打开文档”支持（UIDocumentInteractionController）。
@interface PinyinDocOpener : NSObject <UIDocumentInteractionControllerDelegate>
@property (nonatomic, strong) UIDocumentInteractionController *controller;
@end

@implementation PinyinDocOpener

static PinyinDocOpener *_pinyinOpener = nil;

- (UIViewController *)documentInteractionControllerViewControllerForPreview:(UIDocumentInteractionController *)ctrl
{
    return UnityGetGLViewController();
}

@end

extern "C" {

void _PinyinOpenDocument(const char *path)
{
    if (path == NULL) return;
    NSString *p = [NSString stringWithUTF8String:path];
    NSURL *url = [NSURL fileURLWithPath:p];
    if (![[NSFileManager defaultManager] fileExistsAtPath:p]) return;

    if (_pinyinOpener == nil) _pinyinOpener = [[PinyinDocOpener alloc] init];

    UIDocumentInteractionController *ctrl = [UIDocumentInteractionController interactionControllerWithURL:url];
    ctrl.delegate = _pinyinOpener;
    _pinyinOpener.controller = ctrl;

    UIViewController *root = UnityGetGLViewController();
    CGRect rect = CGRectMake(root.view.bounds.size.width / 2.0,
                             root.view.bounds.size.height - 1.0, 1.0, 1.0);

    // 优先直接预览；失败则弹出“打开方式”菜单
    if (![ctrl presentPreviewAnimated:YES]) {
        [ctrl presentOpenInMenuFromRect:rect inView:root.view animated:YES];
    }
}

}


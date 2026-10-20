import UIKit

final class BookDetailViewController: UIViewController {

    @IBAction func readTapped(_ sender: UIButton) {
        let reader = storyboard?.instantiateViewController(withIdentifier: "ReaderViewController") as! ReaderViewController
        present(reader, animated: true)
    }

    @IBAction func shareTapped(_ sender: UIButton) {
        let share = UIActivityViewController(activityItems: ["A great book"], applicationActivities: nil)
        present(share, animated: true)
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        let cover = UIImage(named: "BookCover")
        _ = cover
    }
}

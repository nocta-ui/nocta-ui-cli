pub struct ConsoleReporter;

impl ConsoleReporter {
    pub fn new() -> Self {
        Self
    }

    pub fn info<S: AsRef<str>>(&self, message: S) {
        println!("{}", message.as_ref());
    }

    pub fn warn<S: AsRef<str>>(&self, message: S) {
        println!("{}", message.as_ref());
    }

    pub fn error<S: AsRef<str>>(&self, message: S) {
        eprintln!("{}", message.as_ref());
    }

    pub fn blank(&self) {
        println!();
    }
}
